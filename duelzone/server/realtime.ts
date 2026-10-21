import type { Server as HTTPServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import {
  games,
  isCompetition,
  type Game,
  type Mode,
  type Player,
} from "../lib/shared";
import { sessionPlayer } from "./auth";
import { Database } from "./db";
import { Match } from "./game";
import { LiveMatch } from "./live-match";

const gameSchema = z.enum(games);
export function realtime(
  http: HTTPServer,
  db: Database,
  origin: string | string[],
) {
  const origins = Array.isArray(origin) ? origin : [origin];
  const io = new Server(http, {
    maxHttpBufferSize: 8192,
    allowRequest: (req, callback) =>
      callback(null, origins.includes(req.headers.origin || "")),
    cors: { origin: origins, credentials: true },
  });
  const sockets = new Map<string, Socket>();
  const queue = new Map<
    string,
    { game: Game; mode: "ranked" | "casual"; at: number; rating: number }
  >();
  const matches = new Map<string, Match>();
  const active = new Map<string, string>();
  const invites = new Map<
    string,
    { host: string; game: Game; expires: number }
  >();
  const disconnects = new Map<string, ReturnType<typeof setTimeout>>();
  const pairing = new Set<string>();
  const tournamentPlayers = new Set<string>();
  const rematched = new Set<string>();
  let matching = false;
  const lobby = () =>
    io.emit("lobby", {
      online: sockets.size,
      queued: queue.size,
      playing: active.size,
    });
  const player = (id: string) =>
    sockets.get(id)?.data.player as Player | undefined;
  async function createMatch(
    ids: string[],
    game: Game,
    mode: Mode,
    onComplete?: (m: Match) => Promise<void>,
  ) {
    const people = await Promise.all(ids.map((id) => db.player(id)));
    if (people.some((p) => !p)) throw new Error("Player unavailable");
    const MatchType = isCompetition(game) ? LiveMatch : Match;
    const match = new MatchType(
      people as Player[],
      game,
      mode,
      (state) => ids.forEach((id) => sockets.get(id)?.emit("match", state)),
      (s) => db.finishMatch(s),
      async (m) => {
        for (const id of ids) active.delete(id);
        lobby();
        io.emit("refresh");
        await onComplete?.(m);
        setTimeout(() => matches.delete(m.state.id), 600000).unref();
      },
    );
    await db.beginMatch(match.state);
    matches.set(match.state.id, match);
    for (const id of ids) {
      queue.delete(id);
      active.set(id, match.state.id);
      for (const [code, i] of invites) if (i.host === id) invites.delete(code);
    }
    match.start();
    lobby();
    return match;
  }
  async function tryPair() {
    if (matching) return;
    matching = true;
    try {
      for (const [id, a] of queue) {
        if (!sockets.has(id) || active.has(id) || pairing.has(id)) continue;
        const candidate = [...queue].find(
          ([other, b]) =>
            other !== id &&
            !pairing.has(other) &&
            sockets.has(other) &&
            a.game === b.game &&
            a.mode === b.mode &&
            (a.mode === "casual" ||
              Math.abs(a.rating - b.rating) <=
                150 +
                  Math.floor((Date.now() - Math.min(a.at, b.at)) / 1000) * 15),
        );
        if (!candidate) continue;
        const other = candidate[0];
        pairing.add(id);
        pairing.add(other);
        try {
          await createMatch([id, other], a.game, a.mode);
        } catch {
          for (const uid of [id, other]) {
            queue.delete(uid);
            sockets
              .get(uid)
              ?.emit("notice", "Could not create the match. Please try again.");
          }
        } finally {
          pairing.delete(id);
          pairing.delete(other);
        }
      }
    } finally {
      matching = false;
    }
  }
  function requireFree(id: string) {
    if (active.has(id) || pairing.has(id) || tournamentPlayers.has(id))
      throw new Error("Finish your current match or tournament first.");
  }
  async function scheduleFixture(
    tid: string,
    round: number,
    slot: number,
    ids: string[],
    game: Game,
  ) {
    const match = await createMatch(ids, game, "tournament", async (m) => {
      if (!m.state.winner) {
        await db.query(
          "UPDATE fixtures SET match_id=NULL WHERE tournament_id=$1 AND round=$2 AND slot=$3",
          [tid, round, slot],
        );
        io.emit("notice", "Tournament tie. A tiebreaker starts now.");
        await scheduleFixture(tid, round, slot, ids, game);
        return;
      }
      await db.query(
        "UPDATE fixtures SET winner_id=$1 WHERE tournament_id=$2 AND round=$3 AND slot=$4",
        [m.state.winner, tid, round, slot],
      );
      tournamentPlayers.delete(ids.find((id) => id !== m.state.winner)!);
      if (round === 2) {
        tournamentPlayers.delete(m.state.winner);
        await db.query(
          "UPDATE tournaments SET status='finished',winner_id=$1 WHERE id=$2",
          [m.state.winner, tid],
        );
        io.emit("refresh");
        return;
      }
      const finalists = await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM tournaments WHERE id=$1 FOR UPDATE", [
          tid,
        ]);
        const semis = (
          await tx.query<{ winner_id: string | null }>(
            "SELECT winner_id FROM fixtures WHERE tournament_id=$1 AND round=1 ORDER BY slot",
            [tid],
          )
        ).rows;
        if (semis.length !== 2 || semis.some((f) => !f.winner_id)) return null;
        const claimed = await tx.query(
          "INSERT INTO fixtures(tournament_id,round,slot,player_a,player_b) VALUES($1,2,0,$2,$3) ON CONFLICT DO NOTHING RETURNING slot",
          [tid, semis[0].winner_id, semis[1].winner_id],
        );
        return claimed.rows.length ? semis.map((f) => f.winner_id!) : null;
      });
      if (finalists) await scheduleFixture(tid, 2, 0, finalists, game);
      io.emit("refresh");
    });
    await db.query(
      "INSERT INTO fixtures(tournament_id,round,slot,match_id,player_a,player_b) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tournament_id,round,slot) DO UPDATE SET match_id=$4,winner_id=NULL",
      [tid, round, slot, match.state.id, ids[0], ids[1]],
    );
    for (const id of ids)
      if (!sockets.has(id))
        disconnects.set(
          id,
          setTimeout(() => void match.finish(id), 20000),
        );
  }
  io.use(async (socket, next) => {
    try {
      const p = await sessionPlayer(db, socket.request.headers.cookie);
      if (!p) return next(new Error("Please sign in."));
      socket.data.player = p;
      next();
    } catch {
      next(new Error("Connection unavailable."));
    }
  });
  io.on("connection", (socket) => {
    const p = socket.data.player as Player;
    const old = sockets.get(p.id);
    if (old) {
      old.emit("replaced");
      old.disconnect(true);
    }
    sockets.set(p.id, socket);
    clearTimeout(disconnects.get(p.id));
    disconnects.delete(p.id);
    const previous = active.get(p.id);
    if (previous) socket.emit("match", matches.get(previous)?.snapshot());
    lobby();
    let events = 0;
    let window = Date.now();
    let busy = false;
    socket.use(async (_packet, next) => {
      if (Date.now() - window > 1000) {
        events = 0;
        window = Date.now();
      }
      if (++events > 35) {
        next(new Error("Slow down"));
        return;
      }
      next();
    });
    socket.on("error", () => {});
    function event(name: string, fn: (data: unknown) => Promise<unknown>) {
      socket.on(name, async (data, ack) => {
        if (typeof ack !== "function") return;
        if (busy) {
          ack({ error: "Please wait for the previous action." });
          return;
        }
        busy = true;
        try {
          const authenticated = await sessionPlayer(
            db,
            socket.request.headers.cookie,
          );
          if (!authenticated) {
            ack({ error: "Your session expired. Please sign in again." });
            socket.disconnect(true);
            return;
          }
          const result = await fn(data);
          ack({ ok: true, ...((result as object) || {}) });
        } catch (error) {
          ack({
            error:
              error instanceof z.ZodError
                ? "Invalid request."
                : error instanceof Error
                  ? error.message
                  : "Something went wrong.",
          });
        } finally {
          busy = false;
        }
      });
    }
    event("queue:join", async (data) => {
      const input = z
        .object({ game: gameSchema, mode: z.enum(["ranked", "casual"]) })
        .parse(data);
      requireFree(p.id);
      const season = await db.currentSeason();
      const rating =
        (
          await db.query<{ rating: number }>(
            "SELECT rating FROM ratings WHERE user_id=$1 AND season_id=$2",
            [p.id, season.id],
          )
        ).rows[0]?.rating || 1000;
      for (const [code, i] of invites)
        if (i.host === p.id) invites.delete(code);
      queue.set(p.id, { ...input, at: Date.now(), rating });
      lobby();
      await tryPair();
      return {};
    });
    event("queue:leave", async () => {
      if (pairing.has(p.id)) throw new Error("Your match is starting.");
      queue.delete(p.id);
      for (const [code, i] of invites)
        if (i.host === p.id) invites.delete(code);
      lobby();
      return {};
    });
    event("invite:create", async (data) => {
      const { game } = z.object({ game: gameSchema }).parse(data);
      requireFree(p.id);
      queue.delete(p.id);
      for (const [code, i] of invites)
        if (i.host === p.id) invites.delete(code);
      const code = randomBytes(18).toString("base64url");
      invites.set(code, { host: p.id, game, expires: Date.now() + 900000 });
      lobby();
      return { code };
    });
    event("invite:join", async (data) => {
      const { code } = z.object({ code: z.string().max(40) }).parse(data);
      requireFree(p.id);
      const invite = invites.get(code);
      if (!invite || invite.expires < Date.now() || !player(invite.host))
        throw new Error("This invite has expired or the host is offline.");
      if (invite.host === p.id)
        throw new Error("Send this invite to a friend.");
      requireFree(invite.host);
      pairing.add(p.id);
      pairing.add(invite.host);
      try {
        await createMatch([invite.host, p.id], invite.game, "friend");
        invites.delete(code);
      } finally {
        pairing.delete(p.id);
        pairing.delete(invite.host);
      }
      return {};
    });
    socket.on("action", (data) => {
      const result = z
        .object({
          challengeId: z.string().uuid(),
          x: z.number().min(0).max(1).optional(),
          y: z.number().min(0).max(1).optional(),
          choice: z.number().int().min(0).max(3).optional(),
          tile: z.number().int().min(0).max(48).optional(),
          target: z.string().max(40).optional(),
          puzzleId: z.string().max(40).optional(),
          ability: z.boolean().optional(),
          dx: z.number().min(-1).max(1).optional(),
          dy: z.number().min(-1).max(1).optional(),
        })
        .safeParse(data);
      if (!result.success) return;
      const id = active.get(p.id);
      if (id) matches.get(id)?.action(p.id, result.data);
    });
    event("match:leave", async () => {
      const id = active.get(p.id);
      if (id) await matches.get(id)?.finish(p.id);
      return {};
    });
    event("rematch", async (data) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(data);
      const m = matches.get(id);
      if (
        rematched.has(id) ||
        !m ||
        m.state.phase !== "finished" ||
        m.state.mode === "tournament" ||
        !m.state.players.some((u) => u.id === p.id)
      )
        throw new Error("Rematch unavailable.");
      requireFree(p.id);
      if (!m.state.rematch.includes(p.id)) m.state.rematch.push(p.id);
      for (const u of m.state.players)
        sockets.get(u.id)?.emit("match", m.snapshot());
      if (m.state.rematch.length === 2) {
        const ids = m.state.players.map((u) => u.id);
        for (const id of ids) {
          requireFree(id);
          if (!sockets.has(id)) throw new Error("Opponent is offline.");
        }
        ids.forEach((id) => pairing.add(id));
        try {
          await createMatch(ids, m.state.game, m.state.mode);
          rematched.add(id);
          setTimeout(() => rematched.delete(id), 600000).unref();
        } finally {
          ids.forEach((id) => pairing.delete(id));
        }
      }
      return {};
    });
    event("tournament:start", async (data) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(data);
      const t = (
        await db.query<{ host_id: string; game: Game; status: string }>(
          "SELECT * FROM tournaments WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!t || t.host_id !== p.id || t.status !== "open")
        throw new Error("Only the host can start an open tournament.");
      const ids = (
        await db.query<{ user_id: string }>(
          "SELECT user_id FROM entrants WHERE tournament_id=$1 ORDER BY joined_at",
          [id],
        )
      ).rows.map((r) => r.user_id);
      if (ids.length !== 4) throw new Error("Four players are required.");
      for (const uid of ids) {
        requireFree(uid);
        if (!sockets.has(uid))
          throw new Error("All four players must be online.");
      }
      ids.forEach((id) => pairing.add(id));
      try {
        const claimed = await db.query(
          "UPDATE tournaments SET status='running' WHERE id=$1 AND status='open' RETURNING id",
          [id],
        );
        if (!claimed.rows.length) throw new Error("Already started.");
        ids.forEach((id) => tournamentPlayers.add(id));
        await scheduleFixture(id, 1, 0, ids.slice(0, 2), t.game);
        await scheduleFixture(id, 1, 1, ids.slice(2, 4), t.game);
        io.emit("refresh");
      } finally {
        ids.forEach((id) => pairing.delete(id));
      }
      return {};
    });
    socket.on("disconnect", () => {
      if (sockets.get(p.id) !== socket) return;
      sockets.delete(p.id);
      queue.delete(p.id);
      for (const [code, i] of invites)
        if (i.host === p.id) invites.delete(code);
      const id = active.get(p.id);
      if (id) {
        const timer = setTimeout(() => {
          disconnects.delete(p.id);
          void matches.get(id)?.finish(p.id);
        }, 20000);
        disconnects.set(p.id, timer);
      }
      lobby();
    });
  });
  const tick = setInterval(() => {
    void tryPair();
    for (const [c, i] of invites) if (i.expires < Date.now()) invites.delete(c);
  }, 2000);
  tick.unref();
  return {
    io,
    stats: () => ({
      online: sockets.size,
      queued: queue.size,
      playing: active.size,
    }),
    busy: (id: string) => active.has(id) || pairing.has(id),
    disconnect: (id: string) => sockets.get(id)?.disconnect(true),
    close: async () => {
      clearInterval(tick);
      disconnects.forEach(clearTimeout);
      matches.forEach((m) => m.dispose());
      await io.close();
    },
  };
}
