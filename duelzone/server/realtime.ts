import type { Server as HTTPServer } from "node:http";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
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
import { FrontierMatch } from "./frontier-match";
import { isFrontier } from "../lib/frontier";
import { LiveMatch } from "./live-match";
import { DailyDuel } from "./daily";
import { Drafts } from "./draft";
import { ReplayRecorder, loadReplay, canReadReplay } from "./replays";
import { grantAchievement } from "./progression";
import { ClassicBotMatch } from "./classic-bot";
import type { Sport } from "../lib/frontier";
import { difficulties, type Difficulty } from "../lib/bot";
import { compatibleGames } from "../lib/platform";
import { Platform } from "./platform";
import { Social } from "./social";
import { lengthScale, type MatchRules } from "../lib/social";

const gameSchema = z.enum(games);
function compactFrontier(
  v: import("../lib/frontier").FrontierView | undefined,
) {
  if (!v) return undefined;
  const { walls, anchors, checkpoints, map, width, height, ...frame } = v;
  return frame;
}
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
    {
      game: Game | "any";
      mode: "ranked" | "casual";
      at: number;
      rating: number;
      excluded: Game[];
    }
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
  const waitSamples: { mode: string; ms: number; at: number }[] = [];
  const drafting = new Set<string>();
  const drafts = new Drafts(sockets);
  const daily = new DailyDuel(db, sockets, (id) => {
    requireFree(id);
    if (queue.has(id))
      throw Error("Cancel your search before starting Daily Duel.");
  });
  const platform = new Platform(db, sockets);
  db.notificationChanged = (id) => platform.changed(id);
  const social = new Social(db, {
    sockets,
    active,
    matches,
    available: (id) =>
      sockets.has(id) &&
      !active.has(id) &&
      !daily.active(id) &&
      !drafting.has(id) &&
      !pairing.has(id) &&
      !tournamentPlayers.has(id) &&
      !queue.has(id),
    start: async (ids, game, rules) => {
      for (const id of ids) {
        requireFree(id);
        if (!sockets.has(id) || queue.has(id))
          throw new Error("A player is offline or busy.");
      }
      ids.forEach((id) => pairing.add(id));
      try {
        return await createMatch(ids, game, "friend", undefined, rules);
      } finally {
        ids.forEach((id) => pairing.delete(id));
      }
    },
  });
  platform.attach({
    available: (id) =>
      sockets.has(id) &&
      !active.has(id) &&
      !daily.active(id) &&
      !drafting.has(id) &&
      !pairing.has(id) &&
      !tournamentPlayers.has(id) &&
      !queue.has(id),
    friend: (a, b, sql) => social.assertFriend(a, b, sql),
    blocked: (a, b, sql) => social.blocked(a, b, sql),
    revokeSpectators: (ids) => social.stopWatching(ids),
    settings: (id, sql) => social.settings(id, sql),
    start: async (ids, game, rules) => {
      for (const id of ids) {
        requireFree(id);
        if (!sockets.has(id) || queue.has(id))
          throw Error("A player is offline or busy.");
      }
      ids.forEach((id) => pairing.add(id));
      try {
        if (game === "showdown" && rules.draft)
          return await beginDraft(ids, "friend", rules);
        return await createMatch(ids, game, "friend", undefined, rules);
      } finally {
        ids.forEach((id) => pairing.delete(id));
      }
    },
  });
  social.relationshipChanged = (a, b) => platform.parties!.invalidate(a, b);
  const socialUpdate = (id: string) =>
    void social.presenceChanged(id).catch(() => {});
  const lobby = () =>
    io.emit("lobby", {
      online: sockets.size,
      queued: queue.size,
      playing: active.size,
    });
  const player = (id: string) =>
    sockets.get(id)?.data.player as Player | undefined;
  function scheduleDisconnect(id: string, matchId: string) {
    clearTimeout(disconnects.get(id));
    const timer = setTimeout(() => {
      disconnects.delete(id);
      if (active.get(id) === matchId && !sockets.has(id))
        void matches.get(matchId)?.finish(id);
    }, 20000);
    timer.unref();
    disconnects.set(id, timer);
  }
  async function createMatch(
    ids: string[],
    game: Game,
    mode: Mode,
    onComplete?: (m: Match) => Promise<void>,
    rules?: MatchRules,
    selection?: Sport[],
  ) {
    const people = await Promise.all(ids.map((id) => db.player(id)));
    if (people.some((p) => !p)) throw new Error("Player unavailable");
    const MatchType = isFrontier(game)
      ? FrontierMatch
      : isCompetition(game)
        ? LiveMatch
        : Match;
    const recording = new ReplayRecorder();
    let lastPhase = "";
    const match = new MatchType(
      people as Player[],
      game,
      mode,
      (state) => {
        recording.capture(state);
        social.broadcast(state);
        const phase = `${state.phase}:${state.challenge?.id}`;
        const frame =
          state.phase === "active" &&
          (state.competition || state.frontier) &&
          lastPhase === phase;
        for (const id of ids) {
          const socket = sockets.get(id);
          if (!socket) continue;
          const personal =
            state.frontier?.game === "shadow" ? match.snapshot(id) : state;
          if (frame && socket?.handshake.auth.frames) {
            socket.volatile.emit("frame", {
              id: state.id,
              serverNow: state.serverNow,
              scores: state.scores,
              competition: state.competition,
              frontier: compactFrontier(personal.frontier),
              deadline: state.deadline,
              round: state.round,
            });
          } else socket?.emit("match", personal);
        }
        lastPhase = phase;
      },
      (s) => db.finishMatch(s),
      async (m) => {
        for (const id of ids) {
          active.delete(id);
          socialUpdate(id);
          platform.changed(id);
        }
        lobby();
        io.emit("refresh");
        await onComplete?.(m);
        await recording
          .save(db, m.snapshot())
          .catch((e) =>
            console.error(
              "Replay recording failed",
              e instanceof Error ? e.message : "unknown",
            ),
          );
        io.emit("refresh");
        setTimeout(() => matches.delete(m.state.id), 600000).unref();
      },
    );
    if (rules) {
      match.state.rules = rules;
      if (!isCompetition(game) && !isFrontier(game))
        match.state.rounds = Math.max(
          3,
          Math.round(match.state.rounds * lengthScale[rules.length]),
        );
    }
    if (selection && match instanceof FrontierMatch)
      match.configureDraft(selection);
    await db.beginMatch(match.state);
    matches.set(match.state.id, match);
    for (const id of ids) {
      queue.delete(id);
      active.set(id, match.state.id);
      void platform.parties?.disconnected(id).catch(() => {});
      void social.cancelFor(id).catch(() => {});
      for (const [code, i] of invites) if (i.host === id) invites.delete(code);
    }
    match.start();
    for (const id of ids)
      if (!sockets.has(id)) scheduleDisconnect(id, match.state.id);
    lobby();
    return match;
  }
  async function createAI(id: string, game: Game, difficulty: Difficulty) {
    pairing.add(id);
    try {
      const human = await db.player(id);
      if (!human || !sockets.has(id))
        throw new Error("Connection unavailable.");
      const bot: Player = {
        id: `bot:${randomUUID()}`,
        username: `DuelZone AI · ${difficulty}`,
        accent: "#a5bce9",
        bio: "",
        bot: true,
        difficulty,
      };
      let previous = "";
      const AIType = isFrontier(game)
        ? FrontierMatch
        : isCompetition(game)
          ? LiveMatch
          : ClassicBotMatch;
      const match = new AIType(
        [human, bot],
        game,
        "ai",
        (state) => {
          const socket = sockets.get(id),
            phase = `${state.phase}:${state.challenge?.id}`;
          if (
            state.phase === "active" &&
            (state.competition || state.frontier) &&
            previous === phase &&
            socket?.handshake.auth.frames
          )
            socket.volatile.emit("frame", {
              id: state.id,
              serverNow: state.serverNow,
              scores: state.scores,
              competition: state.competition,
              frontier: compactFrontier(
                state.frontier ? match.snapshot(id).frontier : undefined,
              ),
              deadline: state.deadline,
              round: state.round,
            });
          else
            socket?.emit("match", state.frontier ? match.snapshot(id) : state);
          previous = phase;
        },
        async (state) => {
          if (state.reason === "Score")
            await db.query(
              "INSERT INTO training_runs(id,user_id,game,difficulty,score,opponent_score,won) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
              [
                state.id,
                id,
                game,
                difficulty,
                state.scores[id],
                state.scores[bot.id],
                state.winner === id,
              ],
            );
          return {};
        },
        async (m) => {
          active.delete(id);
          socialUpdate(id);
          lobby();
          setTimeout(() => matches.delete(m.state.id), 600000).unref();
        },
      );
      match.configureBot(bot.id, difficulty);
      queue.delete(id);
      for (const [code, invite] of invites)
        if (invite.host === id) invites.delete(code);
      matches.set(match.state.id, match);
      active.set(id, match.state.id);
      void social.cancelFor(id).catch(() => {});
      match.start();
      lobby();
    } finally {
      pairing.delete(id);
    }
  }
  async function createGhost(id: string, replayId: string, sourceId: string) {
    pairing.add(id);
    try {
      if (!(await canReadReplay(db, replayId, id)))
        throw Error("This recording is private or unavailable.");
      const data = await loadReplay(db, replayId),
        human = await db.player(id);
      if (
        !data ||
        data.game !== "grapple" ||
        !data.players.some((p) => p.id === sourceId) ||
        !human ||
        !sockets.has(id)
      )
        throw Error("Choose an available Grapple Rush recording.");
      const source = data.players.find((p) => p.id === sourceId)!,
        ghost: Player = {
          id: "ghost:" + randomUUID(),
          username: source.username + " · recorded ghost",
          accent: "#a5bce9",
          bio: "",
          ghost: true,
        };
      let prior = "";
      const match = new FrontierMatch(
        [human, ghost],
        "grapple",
        "ghost",
        (state) => {
          const key = state.phase + ":" + state.challenge?.id,
            socket = sockets.get(id);
          if (
            state.phase === "active" &&
            state.frontier &&
            prior === key &&
            socket?.handshake.auth.frames
          )
            socket.volatile.emit("frame", {
              id: state.id,
              serverNow: state.serverNow,
              scores: state.scores,
              frontier: compactFrontier(state.frontier),
              deadline: state.deadline,
              round: state.round,
            });
          else socket?.emit("match", state);
          prior = key;
        },
        async (state) => {
          if (state.reason === "Score")
            await db.query(
              "INSERT INTO training_runs(id,user_id,game,difficulty,score,opponent_score,won) VALUES($1,$2,'grapple','ghost',$3,$4,$5) ON CONFLICT DO NOTHING",
              [
                state.id,
                id,
                state.scores[id],
                state.scores[ghost.id],
                state.winner === id,
              ],
            );
          return {};
        },
        async (m) => {
          active.delete(id);
          socialUpdate(id);
          lobby();
          setTimeout(() => matches.delete(m.state.id), 600000).unref();
        },
      );
      match.configureGhost(data, sourceId, ghost.id);
      queue.delete(id);
      matches.set(match.state.id, match);
      active.set(id, match.state.id);
      match.start();
      lobby();
    } finally {
      pairing.delete(id);
    }
  }
  async function beginDraft(ids: string[], mode: Mode, rules?: MatchRules) {
    const people = await Promise.all(ids.map((id) => db.player(id)));
    if (people.some((p) => !p) || ids.some((id) => !sockets.has(id)))
      throw Error("Both players must be connected.");
    ids.forEach((id) => {
      queue.delete(id);
      drafting.add(id);
    });
    try {
      for (const id of ids) await social.cancelFor(id);
      drafts.create(
        people as Player[],
        async (selection) => {
          if (
            ids.some((id) => !sockets.has(id)) ||
            (await social.blocked(ids[0], ids[1]))
          )
            throw Error("Your opponent is unavailable.");
          await createMatch(
            ids,
            "showdown",
            mode,
            undefined,
            { length: "standard", spectators: false, ...rules, draft: true },
            selection,
          );
        },
        () => {
          ids.forEach((id) => drafting.delete(id));
          lobby();
        },
      );
    } catch (error) {
      ids.forEach((id) => drafting.delete(id));
      lobby();
      throw error;
    }
    lobby();
  }
  async function tryPair() {
    if (matching) return;
    matching = true;
    try {
      for (const [id, a] of queue) {
        if (!sockets.has(id) || active.has(id) || pairing.has(id)) continue;
        const candidates = [...queue].filter(
          ([other, b]) =>
            other !== id &&
            !pairing.has(other) &&
            sockets.has(other) &&
            compatibleGames(a.game, b.game, a.excluded, b.excluded).length >
              0 &&
            a.mode === b.mode &&
            (a.mode === "casual" ||
              Math.abs(a.rating - b.rating) <=
                150 +
                  Math.floor((Date.now() - Math.min(a.at, b.at)) / 1000) * 15),
        );
        candidates.sort((x, y) =>
          a.mode === "ranked"
            ? Math.abs(a.rating - x[1].rating) -
                Math.abs(a.rating - y[1].rating) || x[1].at - y[1].at
            : x[1].at - y[1].at,
        );
        let candidate: (typeof candidates)[number] | undefined;
        for (const c of candidates)
          if (!(await social.blocked(id, c[0]))) {
            candidate = c;
            break;
          }
        if (!candidate) continue;
        const other = candidate[0];
        if (
          queue.get(id) !== a ||
          queue.get(other) !== candidate[1] ||
          !sockets.has(id) ||
          !sockets.has(other) ||
          active.has(id) ||
          active.has(other) ||
          pairing.has(id) ||
          pairing.has(other)
        )
          continue;
        pairing.add(id);
        pairing.add(other);
        try {
          const compatible = compatibleGames(
            a.game,
            candidate[1].game,
            a.excluded,
            candidate[1].excluded,
          );
          const game = compatible[randomInt(compatible.length)];
          if (game === "showdown" && a.mode === "ranked")
            await beginDraft([id, other], a.mode);
          else await createMatch([id, other], game, a.mode);
          const now = Date.now();
          waitSamples.push(
            { mode: a.mode, ms: Math.max(0, now - a.at), at: now },
            { mode: a.mode, ms: Math.max(0, now - candidate[1].at), at: now },
          );
          if (waitSamples.length > 100)
            waitSamples.splice(0, waitSamples.length - 100);
        } catch {
          for (const uid of [id, other]) {
            queue.delete(uid);
            sockets.get(uid)?.emit("queue:cancelled");
            sockets
              .get(uid)
              ?.emit("notice", "Could not create the match. Please try again.");
          }
          lobby();
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
    if (
      drafting.has(id) ||
      daily.active(id) ||
      active.has(id) ||
      pairing.has(id) ||
      tournamentPlayers.has(id)
    )
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
      const tournament = (
        await db.query<{ capacity: number }>(
          "SELECT capacity FROM tournaments WHERE id=$1",
          [tid],
        )
      ).rows[0];
      if (round === Math.log2(tournament.capacity)) {
        tournamentPlayers.delete(m.state.winner);
        await db.query(
          "UPDATE tournaments SET status='finished',winner_id=$1 WHERE id=$2",
          [m.state.winner, tid],
        );
        await db.transaction(async (sql) => {
          await grantAchievement(sql, m.state.winner!, "tournament-win");
          await sql.query(
            "INSERT INTO activity_events(id,user_id,kind,game) VALUES($1,$2,'tournament',$3) ON CONFLICT DO NOTHING",
            [tid + ":winner", m.state.winner!, game],
          );
        });
        platform.changed(m.state.winner);
        io.emit("refresh");
        return;
      }
      const finalists = await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM tournaments WHERE id=$1 FOR UPDATE", [
          tid,
        ]);
        const nextSlot = Math.floor(slot / 2);
        const previous = (
          await tx.query<{ winner_id: string | null }>(
            "SELECT winner_id FROM fixtures WHERE tournament_id=$1 AND round=$2 AND slot IN($3,$4) ORDER BY slot",
            [tid, round, nextSlot * 2, nextSlot * 2 + 1],
          )
        ).rows;
        if (previous.length !== 2 || previous.some((f) => !f.winner_id))
          return null;
        const claimed = await tx.query(
          "INSERT INTO fixtures(tournament_id,round,slot,player_a,player_b) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING slot",
          [
            tid,
            round + 1,
            nextSlot,
            previous[0].winner_id,
            previous[1].winner_id,
          ],
        );
        return claimed.rows.length
          ? { ids: previous.map((f) => f.winner_id!), slot: nextSlot }
          : null;
      });
      if (finalists)
        await scheduleFixture(
          tid,
          round + 1,
          finalists.slot,
          finalists.ids,
          game,
        );
      io.emit("refresh");
    });
    await db.query(
      "INSERT INTO fixtures(tournament_id,round,slot,match_id,player_a,player_b) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tournament_id,round,slot) DO UPDATE SET match_id=$4,winner_id=NULL",
      [tid, round, slot, match.state.id, ids[0], ids[1]],
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
    if (previous) socket.emit("match", matches.get(previous)?.snapshot(p.id));
    lobby();
    socialUpdate(p.id);
    void platform.parties?.disconnected(p.id).catch(() => {});
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
    socket.on("clock", (ack) => {
      if (typeof ack === "function") ack(Date.now());
    });
    function event(name: string, fn: (data: unknown) => Promise<unknown>) {
      socket.on(name, async (data, ack) => {
        if (typeof ack !== "function") return;
        const readOnly = [
          "platform:state",
          "social:activity",
          "social:state",
          "social:search",
          "social:messages",
          "social:profile",
          "social:read",
        ].includes(name);
        if (busy && !readOnly) {
          ack({ error: "Please wait for the previous action." });
          return;
        }
        if (!readOnly) busy = true;
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
          if (!readOnly) busy = false;
        }
      });
    }
    event("ghost:start", async (data) => {
      const input = z
        .object({ replayId: z.string().uuid(), sourceId: z.string().uuid() })
        .parse(data);
      requireFree(p.id);
      await createGhost(p.id, input.replayId, input.sourceId);
      return {};
    });
    event("ai:start", async (data) => {
      const { game, difficulty } = z
        .object({
          game: gameSchema,
          difficulty: z.enum(difficulties),
        })
        .parse(data);
      requireFree(p.id);
      await createAI(p.id, game, difficulty);
      return {};
    });
    daily.bind(socket, event);
    drafts.bind(socket, event);
    social.bind(socket, event);
    platform.bind(socket, event);
    event("queue:join", async (data) => {
      const input = z
        .object({
          game: z.union([gameSchema, z.literal("any")]),
          mode: z.enum(["ranked", "casual"]),
        })
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
      if (!socket.connected || sockets.get(p.id) !== socket)
        throw new Error("Connection lost. Reconnect and try again.");
      const excluded =
        input.game === "any" ? (await platform.preferences(p.id)).excluded : [];
      queue.set(p.id, { ...input, at: Date.now(), rating, excluded });
      lobby();
      await tryPair();
      const observed = waitSamples
        .filter((s) => s.mode === input.mode && Date.now() - s.at < 900000)
        .map((s) => s.ms)
        .sort((a, b) => a - b);
      return {
        estimate:
          observed.length >= 6
            ? {
                seconds: Math.max(
                  1,
                  Math.round(observed[Math.floor(observed.length / 2)] / 1000),
                ),
                searches: observed.length,
              }
            : null,
      };
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
      if (await social.blocked(p.id, invite.host))
        throw new Error("This invite is unavailable.");
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
          primary: z.boolean().optional(),
          secondary: z.boolean().optional(),
          jump: z.boolean().optional(),
          aimX: z.number().min(-1).max(1).optional(),
          aimY: z.number().min(-1).max(1).optional(),
          dx: z.number().min(-1).max(1).optional(),
          dy: z.number().min(-1).max(1).optional(),
          seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
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
      if (m.state.mode === "ghost" && m.state.ghost) {
        await createGhost(p.id, m.state.ghost.replayId, m.state.ghost.sourceId);
        rematched.add(id);
        setTimeout(() => rematched.delete(id), 600000).unref();
        return {};
      }
      if (m.state.mode === "ai") {
        const bot = m.state.players.find((player) => player.bot)!;
        await createAI(p.id, m.state.game, bot.difficulty!);
        rematched.add(id);
        setTimeout(() => rematched.delete(id), 600000).unref();
        return {};
      }
      if (await social.blocked(m.state.players[0].id, m.state.players[1].id))
        throw new Error("Rematch unavailable.");
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
          if (m.state.game === "showdown" && m.state.rules?.draft)
            await beginDraft(ids, m.state.mode, m.state.rules);
          else
            await createMatch(
              ids,
              m.state.game,
              m.state.mode,
              undefined,
              m.state.rules,
            );
          rematched.add(id);
          setTimeout(() => rematched.delete(id), 600000).unref();
        } finally {
          ids.forEach((id) => pairing.delete(id));
        }
      }
      return {};
    });
    event("tournament:ready", async (data) => {
      const { id, ready } = z
        .object({ id: z.string().uuid(), ready: z.boolean() })
        .parse(data);
      if (ready) requireFree(p.id);
      const row = await db.query(
        "UPDATE entrants SET ready=$3 WHERE user_id=$1 AND tournament_id=$2 AND EXISTS(SELECT 1 FROM tournaments WHERE id=$2 AND status='open') RETURNING user_id",
        [p.id, id, ready],
      );
      if (!row.rows.length) throw Error("Join an open tournament first.");
      io.emit("refresh");
      return {};
    });
    event("tournament:start", async (data) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(data);
      const t = (
        await db.query<{
          host_id: string;
          game: Game;
          status: string;
          capacity: number;
        }>("SELECT * FROM tournaments WHERE id=$1", [id])
      ).rows[0];
      if (!t || t.host_id !== p.id || t.status !== "open")
        throw new Error("Only the host can start an open tournament.");
      const ids = (
        await db.query<{ user_id: string }>(
          "SELECT user_id FROM entrants WHERE tournament_id=$1 ORDER BY joined_at",
          [id],
        )
      ).rows.map((r) => r.user_id);
      if (ids.length !== t.capacity)
        throw new Error(`${t.capacity} players are required.`);
      if (
        (
          await db.query(
            "SELECT 1 FROM entrants WHERE tournament_id=$1 AND ready=false",
            [id],
          )
        ).rows.length
      )
        throw Error(
          "Every entrant must ready up before the tournament starts.",
        );
      for (const uid of ids) {
        requireFree(uid);
        if (!sockets.has(uid)) throw new Error("Every entrant must be online.");
      }
      ids.forEach((id) => pairing.add(id));
      try {
        const claimed = await db.query(
          "UPDATE tournaments SET status='running' WHERE id=$1 AND status='open' RETURNING id",
          [id],
        );
        if (!claimed.rows.length) throw new Error("Already started.");
        ids.forEach((id) => tournamentPlayers.add(id));
        for (let slot = 0; slot < ids.length / 2; slot++)
          await scheduleFixture(
            id,
            1,
            slot,
            ids.slice(slot * 2, slot * 2 + 2),
            t.game,
          );
        io.emit("refresh");
      } finally {
        ids.forEach((id) => pairing.delete(id));
      }
      return {};
    });
    socket.on("disconnect", () => {
      if (sockets.get(p.id) !== socket) return;
      sockets.delete(p.id);
      void db
        .query(
          "UPDATE entrants SET ready=false WHERE user_id=$1 AND tournament_id IN(SELECT id FROM tournaments WHERE status='open')",
          [p.id],
        )
        .then(() => io.emit("refresh"))
        .catch(() => {});
      drafts.cancelPlayer(p.id);
      void platform.parties?.disconnected(p.id).catch(() => {});
      void social.cancelFor(p.id).catch(() => {});
      queue.delete(p.id);
      for (const [code, i] of invites)
        if (i.host === p.id) invites.delete(code);
      const id = active.get(p.id);
      if (id) scheduleDisconnect(p.id, id);
      lobby();
    });
  });
  const tick = setInterval(() => {
    void tryPair();
    void social.sweep().catch(() => {});
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
    busy: (id: string) =>
      drafting.has(id) || daily.active(id) || active.has(id) || pairing.has(id),
    disconnect: (id: string) => sockets.get(id)?.disconnect(true),
    close: async () => {
      clearInterval(tick);
      daily.dispose();
      drafts.dispose();
      disconnects.forEach(clearTimeout);
      matches.forEach((m) => m.dispose());
      await io.close();
    },
  };
}
