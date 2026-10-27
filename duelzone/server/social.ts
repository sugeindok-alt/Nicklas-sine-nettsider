import { randomUUID, randomInt } from "node:crypto";
import { z } from "zod";
import type { Socket } from "socket.io";
import type { Database, SQL } from "./db";
import type { Match } from "./game";
import { games, type Game, type MatchState, type Player } from "../lib/shared";
import {
  defaultPrivacy,
  defaultRules,
  watchableGames,
  type MatchRules,
  type Privacy,
  type SocialChallenge,
} from "../lib/social";

export const socialSchema = `
CREATE TABLE IF NOT EXISTS friendships(a TEXT REFERENCES users(id) ON DELETE CASCADE,b TEXT REFERENCES users(id) ON DELETE CASCADE,requester TEXT REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('pending','accepted')),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(a,b),CHECK(a<b));
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(b);
CREATE TABLE IF NOT EXISTS social_blocks(owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,target_id TEXT REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(owner_id,target_id),CHECK(owner_id<>target_id));
CREATE TABLE IF NOT EXISTS social_settings(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,settings JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS private_messages(id TEXT PRIMARY KEY,from_id TEXT REFERENCES users(id) ON DELETE CASCADE,to_id TEXT REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS private_messages_thread ON private_messages(from_id,to_id,created_at DESC);
CREATE INDEX IF NOT EXISTS private_messages_unread ON private_messages(to_id) WHERE read_at IS NULL;
CREATE TABLE IF NOT EXISTS social_challenges(id TEXT PRIMARY KEY,from_id TEXT REFERENCES users(id) ON DELETE CASCADE,to_id TEXT REFERENCES users(id) ON DELETE CASCADE,game TEXT NOT NULL,rules JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending',expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),match_id TEXT REFERENCES matches(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS social_challenges_from ON social_challenges(from_id,created_at DESC);
CREATE INDEX IF NOT EXISTS social_challenges_to ON social_challenges(to_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS social_challenges_pending_pair ON social_challenges(LEAST(from_id,to_id),GREATEST(from_id,to_id)) WHERE status='pending';
CREATE TABLE IF NOT EXISTS social_limits(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),count INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(user_id,kind));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL DEFAULT '{}';
UPDATE social_challenges SET status='expired' WHERE status='pending';
`;
const targetSchema = z.object({ target: z.string().uuid() });
const rulesSchema = z.object({
  length: z.enum(["quick", "standard", "extended"]),
  spectators: z.boolean(),
});
const privacySchema = z.object({
  activity: z.boolean().default(false),
  replays: z.boolean().default(false),
  requests: z.boolean(),
  messages: z.boolean(),
  challenges: z.boolean(),
  presence: z.boolean(),
  spectators: z.boolean(),
});
type Runtime = {
  sockets: Map<string, Socket>;
  active: Map<string, string>;
  matches: Map<string, Match>;
  available: (id: string) => boolean;
  start: (ids: string[], game: Game, rules: MatchRules) => Promise<Match>;
};
type Event = (name: string, fn: (data: unknown) => Promise<unknown>) => void;

export class Social {
  relationshipChanged?: (a: string, b: string) => Promise<void>;
  private watching = new Map<string, string>();
  private sweepBusy = false;
  constructor(
    private db: Database,
    private runtime: Runtime,
  ) {}
  private pair(a: string, b: string) {
    return [a, b].sort();
  }
  async blocked(a: string, b: string, sql: SQL = this.db) {
    return !!(
      await sql.query(
        "SELECT 1 FROM social_blocks WHERE (owner_id=$1 AND target_id=$2) OR (owner_id=$2 AND target_id=$1)",
        [a, b],
      )
    ).rows.length;
  }
  async settings(id: string, sql: SQL = this.db): Promise<Privacy> {
    const row = (
      await sql.query<{ settings: Privacy }>(
        "SELECT settings FROM social_settings WHERE user_id=$1",
        [id],
      )
    ).rows[0];
    return { ...defaultPrivacy, ...row?.settings };
  }
  async assertFriend(a: string, b: string, sql: SQL = this.db) {
    if (a === b || (await this.blocked(a, b, sql)))
      throw Error("This player is unavailable.");
    const row = (
      await sql.query<{ status: string }>(
        "SELECT status FROM friendships WHERE a=$1 AND b=$2",
        this.pair(a, b),
      )
    ).rows[0];
    if (row?.status !== "accepted")
      throw Error("Add this player as a friend first.");
  }
  private async locked<T>(a: string, b: string, fn: (sql: SQL) => Promise<T>) {
    if (a === b) throw Error("Choose another player.");
    return this.db.transaction(async (sql) => {
      const rows = await sql.query(
        "SELECT id FROM users WHERE id IN ($1,$2) ORDER BY id FOR UPDATE",
        [a, b],
      );
      if (rows.rows.length !== 2) throw Error("Player unavailable.");
      return fn(sql);
    });
  }
  private async limit(
    id: string,
    kind: string,
    max: number,
    seconds: number,
    sql: SQL,
  ) {
    const row = (
      await sql.query<{ count: number }>(
        `INSERT INTO social_limits(user_id,kind) VALUES($1,$2) ON CONFLICT(user_id,kind) DO UPDATE SET count=CASE WHEN social_limits.started_at < now()-($3 * interval '1 second') THEN 1 ELSE social_limits.count+1 END,started_at=CASE WHEN social_limits.started_at < now()-($3 * interval '1 second') THEN now() ELSE social_limits.started_at END RETURNING count`,
        [id, kind, seconds],
      )
    ).rows[0];
    if (row.count > max)
      throw Error("Too many attempts. Please wait before trying again.");
  }
  private changed(...ids: string[]) {
    for (const id of new Set(ids))
      this.runtime.sockets.get(id)?.emit("social:changed");
  }
  private async notice(
    id: string,
    text: string,
    kind: string,
    target?: string,
  ) {
    await this.db.notify(id, kind, text, target);
    this.runtime.sockets.get(id)?.emit("social:notice", { text, kind, target });
  }
  private async presence(id: string, settings?: Privacy) {
    const prefs = settings || (await this.settings(id)),
      match = this.runtime.matches.get(this.runtime.active.get(id) || "");
    return {
      presence: !prefs.presence
        ? "hidden"
        : !this.runtime.sockets.has(id)
          ? "offline"
          : match
            ? "in-match"
            : this.runtime.sockets.get(id)?.data.away
              ? "away"
              : "online",
      game:
        prefs.presence && this.runtime.sockets.has(id) && match
          ? match.state.game
          : null,
      watchable: !!(
        prefs.presence &&
        prefs.spectators &&
        match?.state.rules?.spectators &&
        watchableGames.includes(match.state.game) &&
        match.state.phase !== "finished"
      ),
    };
  }
  async presenceChanged(id: string) {
    const peers = (
      await this.db.query<{ id: string }>(
        "SELECT CASE WHEN a=$1 THEN b ELSE a END AS id FROM friendships WHERE (a=$1 OR b=$1) AND status='accepted'",
        [id],
      )
    ).rows;
    const presence = await this.presence(id);
    for (const peer of peers)
      this.runtime.sockets
        .get(peer.id)
        ?.emit("social:presence", { id, ...presence });
  }
  async state(id: string) {
    const links = (
      await this.db.query<
        Player & {
          requester: string;
          status: string;
          created_at: string;
          privacy: Privacy | null;
        }
      >(
        "SELECT u.id,u.username,u.accent,u.bio,CASE WHEN u.avatar<>'' THEN '/api/media/'||u.id||'/avatar?v='||u.media_version ELSE '' END AS avatar,f.requester,f.status,f.created_at,s.settings AS privacy FROM friendships f JOIN users u ON u.id=CASE WHEN f.a=$1 THEN f.b ELSE f.a END LEFT JOIN social_settings s ON s.user_id=u.id WHERE f.a=$1 OR f.b=$1 ORDER BY u.username_key",
        [id],
      )
    ).rows;
    const unread = (
      await this.db.query<{ from_id: string; count: number }>(
        "SELECT from_id,count(*)::int AS count FROM private_messages WHERE to_id=$1 AND read_at IS NULL GROUP BY from_id",
        [id],
      )
    ).rows;
    const friends = await Promise.all(
      links
        .filter((p) => p.status === "accepted")
        .map(async ({ privacy, ...p }) => ({
          ...p,
          ...(await this.presence(p.id, { ...defaultPrivacy, ...privacy })),
          unread: unread.find((r) => r.from_id === p.id)?.count || 0,
        })),
    );
    const challenges = (
      await this.db.query(
        "SELECT c.*,a.username AS sender,b.username AS recipient FROM social_challenges c JOIN users a ON a.id=c.from_id JOIN users b ON b.id=c.to_id WHERE (from_id=$1 OR to_id=$1) ORDER BY created_at DESC LIMIT 50",
        [id],
      )
    ).rows;
    const blocked = (
      await this.db.query(
        "SELECT u.id,u.username,u.accent,u.bio,CASE WHEN u.avatar<>'' THEN '/api/media/'||u.id||'/avatar?v='||u.media_version ELSE '' END AS avatar FROM social_blocks b JOIN users u ON u.id=b.target_id WHERE owner_id=$1 ORDER BY u.username_key",
        [id],
      )
    ).rows;
    return {
      friends,
      requests: links
        .filter((p) => p.status === "pending")
        .map(({ privacy, ...p }) => ({
          ...p,
          from_id: p.requester,
          to_id: p.requester === id ? p.id : id,
        })),
      challenges,
      blocked,
      settings: await this.settings(id),
    };
  }
  async cancelFor(id: string) {
    const rows = (
      await this.db.query<{ from_id: string; to_id: string }>(
        "UPDATE social_challenges SET status='cancelled' WHERE status='pending' AND (from_id=$1 OR to_id=$1) RETURNING from_id,to_id",
        [id],
      )
    ).rows;
    for (const r of rows) this.changed(r.from_id, r.to_id);
    this.watching.delete(id);
    await this.presenceChanged(id);
  }
  async sweep() {
    if (this.sweepBusy) return;
    this.sweepBusy = true;
    try {
      const rows = (
        await this.db.query<{ from_id: string; to_id: string }>(
          "UPDATE social_challenges SET status='expired' WHERE status='pending' AND expires_at<=now() RETURNING from_id,to_id",
        )
      ).rows;
      for (const r of rows) this.changed(r.from_id, r.to_id);
    } finally {
      this.sweepBusy = false;
    }
  }
  broadcast(state: MatchState) {
    for (const [id, mid] of this.watching)
      if (mid === state.id) {
        const socket = this.runtime.sockets.get(id);
        if (state.phase === "finished") {
          socket?.emit("spectate", state);
          this.watching.delete(id);
        } else socket?.volatile.emit("spectate", state);
      }
  }
  stopWatching(ids: string[]) {
    for (const [viewer, mid] of this.watching) {
      const match = this.runtime.matches.get(mid);
      if (
        ids.includes(viewer) ||
        match?.state.players.some((p) => ids.includes(p.id))
      ) {
        this.watching.delete(viewer);
        this.runtime.sockets
          .get(viewer)
          ?.emit("spectate:ended", "Spectating permission changed.");
      }
    }
  }
  bind(socket: Socket, event: Event) {
    const me = socket.data.player as Player,
      id = me.id;
    event("social:activity", async (data) => {
      const { away } = z.object({ away: z.boolean() }).parse(data);
      if (socket.data.away !== away) {
        socket.data.away = away;
        await this.presenceChanged(id);
      }
      return {};
    });
    event("social:state", async () => ({ social: await this.state(id) }));
    event("social:search", async (data) => {
      const { query } = z
        .object({
          query: z
            .string()
            .trim()
            .min(2)
            .max(20)
            .regex(/^[a-zA-Z0-9_]+$/),
        })
        .parse(data);
      const rows = (
        await this.db.query(
          "SELECT u.id,u.username,u.accent,u.bio,CASE WHEN u.avatar<>'' THEN '/api/media/'||u.id||'/avatar?v='||u.media_version ELSE '' END AS avatar FROM users u WHERE u.id<>$1 AND strpos(u.username_key,$2)>0 AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.owner_id=$1 AND b.target_id=u.id) OR (b.owner_id=u.id AND b.target_id=$1)) ORDER BY CASE WHEN u.username_key=$2 THEN 0 ELSE 1 END,u.username_key LIMIT 20",
          [id, query.toLowerCase()],
        )
      ).rows;
      return { players: rows };
    });
    event("social:request", async (data) => {
      const { target } = targetSchema.parse(data);
      await this.locked(id, target, async (sql) => {
        if (
          (await this.blocked(id, target, sql)) ||
          !(await this.settings(target, sql)).requests
        )
          throw Error("This player is not accepting requests.");
        await this.limit(id, "requests", 15, 3600, sql);
        const current = (
          await sql.query(
            "SELECT 1 FROM friendships WHERE a=$1 AND b=$2",
            this.pair(id, target),
          )
        ).rows;
        if (current.length)
          throw Error("You are already friends or have a pending request.");
        for (const uid of [id, target]) {
          const size = (
            await sql.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM friendships WHERE a=$1 OR b=$1",
              [uid],
            )
          ).rows[0].n;
          if (size >= 200)
            throw Error(
              "This friends list is full. Remove a request or friend first.",
            );
        }
        await sql.query(
          "INSERT INTO friendships(a,b,requester,status) VALUES($1,$2,$3,'pending')",
          [...this.pair(id, target), id],
        );
      });
      this.changed(id, target);
      await this.notice(
        target,
        `${me.username} sent you a friend request.`,
        "request",
        id,
      );
      return {};
    });
    event("social:respond", async (data) => {
      const { target, accept } = targetSchema
        .extend({ accept: z.boolean() })
        .parse(data);
      await this.locked(id, target, async (sql) => {
        const row = (
          await sql.query<{ requester: string; status: string }>(
            "SELECT requester,status FROM friendships WHERE a=$1 AND b=$2",
            this.pair(id, target),
          )
        ).rows[0];
        if (
          !row ||
          row.status !== "pending" ||
          row.requester !== target ||
          (await this.blocked(id, target, sql))
        )
          throw Error("This request is no longer available.");
        if (accept)
          await sql.query(
            "UPDATE friendships SET status='accepted' WHERE a=$1 AND b=$2",
            this.pair(id, target),
          );
        else
          await sql.query(
            "DELETE FROM friendships WHERE a=$1 AND b=$2",
            this.pair(id, target),
          );
      });
      this.changed(id, target);
      if (accept)
        await this.notice(
          target,
          `${me.username} accepted your friend request.`,
          "friend",
          id,
        );
      return {};
    });
    event("social:remove", async (data) => {
      const { target } = targetSchema.parse(data);
      await this.locked(id, target, async (sql) => {
        await sql.query(
          "DELETE FROM friendships WHERE a=$1 AND b=$2",
          this.pair(id, target),
        );
        await sql.query(
          "UPDATE social_challenges SET status='cancelled' WHERE status='pending' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))",
          [id, target],
        );
      });
      await this.relationshipChanged?.(id, target);
      this.stopWatching([id, target]);
      this.changed(id, target);
      return {};
    });
    event("social:block", async (data) => {
      const { target, blocked } = targetSchema
        .extend({ blocked: z.boolean() })
        .parse(data);
      await this.locked(id, target, async (sql) => {
        if (blocked) {
          await sql.query(
            "INSERT INTO social_blocks VALUES($1,$2) ON CONFLICT DO NOTHING",
            [id, target],
          );
          await sql.query(
            "DELETE FROM friendships WHERE a=$1 AND b=$2",
            this.pair(id, target),
          );
          await sql.query(
            "UPDATE social_challenges SET status='cancelled' WHERE status='pending' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))",
            [id, target],
          );
        } else
          await sql.query(
            "DELETE FROM social_blocks WHERE owner_id=$1 AND target_id=$2",
            [id, target],
          );
      });
      await this.relationshipChanged?.(id, target);
      this.stopWatching([id, target]);
      this.changed(id, target);
      return {};
    });
    event("social:settings", async (data) => {
      const prefs = privacySchema.parse(data);
      await this.db.transaction(async (sql) => {
        await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
        await sql.query(
          "INSERT INTO social_settings VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET settings=$2",
          [id, JSON.stringify(prefs)],
        );
      });
      if (!prefs.spectators || !prefs.presence) this.stopWatching([id]);
      if (!prefs.challenges) await this.cancelFor(id);
      this.changed(id);
      await this.presenceChanged(id);
      return {};
    });
    event("social:messages", async (data) => {
      const { target, before } = targetSchema
        .extend({ before: z.string().datetime().optional() })
        .parse(data);
      await this.assertFriend(id, target);
      const rows = (
        await this.db.query(
          "SELECT * FROM private_messages WHERE ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)) AND created_at < $3::timestamptz ORDER BY created_at DESC,id DESC LIMIT 50",
          [id, target, before || new Date().toISOString()],
        )
      ).rows;
      return { messages: rows.reverse() };
    });
    event("social:send", async (data) => {
      const { target, body, messageId } = targetSchema
        .extend({
          body: z.string().trim().min(1).max(1000),
          messageId: z.string().uuid(),
        })
        .parse(data);
      let inserted = false;
      const message = await this.locked(id, target, async (sql) => {
        await this.assertFriend(id, target, sql);
        if (!(await this.settings(target, sql)).messages)
          throw Error("This friend has paused private messages.");
        const old = (
          await sql.query<{ from_id: string; to_id: string; body: string }>(
            "SELECT * FROM private_messages WHERE id=$1",
            [messageId],
          )
        ).rows[0];
        if (old) {
          if (old.from_id !== id || old.to_id !== target || old.body !== body)
            throw Error("Message ID already used.");
          return old;
        }
        await this.limit(id, "messages", 30, 60, sql);
        inserted = true;
        return (
          await sql.query(
            "INSERT INTO private_messages(id,from_id,to_id,body) VALUES($1,$2,$3,$4) RETURNING *",
            [messageId, id, target, body],
          )
        ).rows[0];
      });
      if (inserted) {
        for (const uid of [id, target])
          this.runtime.sockets.get(uid)?.emit("social:message", message);
        this.changed(id, target);
      }
      return { message };
    });
    event("social:read", async (data) => {
      const { target } = targetSchema.parse(data);
      await this.assertFriend(id, target);
      await this.db.query(
        "UPDATE private_messages SET read_at=now() WHERE from_id=$1 AND to_id=$2 AND read_at IS NULL",
        [target, id],
      );
      this.changed(id);
      return {};
    });
    event("social:profile", async (data) => {
      const { target } = targetSchema.parse(data);
      await this.assertFriend(id, target);
      const rivalry = (
        await this.db.query(
          "SELECT count(*)::int AS played,count(*) FILTER(WHERE m.winner_id=$1)::int AS wins,count(*) FILTER(WHERE m.winner_id=$2)::int AS losses,count(*) FILTER(WHERE m.winner_id IS NULL)::int AS draws FROM matches m JOIN results a ON a.match_id=m.id AND a.user_id=$1 JOIN results b ON b.match_id=m.id AND b.user_id=$2 WHERE m.status='finished'",
          [id, target],
        )
      ).rows[0];
      return { profile: await this.db.profile(target), rivalry };
    });
    event("social:challenge", async (data) => {
      const input = targetSchema
        .extend({
          game: z.union([z.enum(games), z.literal("any")]),
          rules: rulesSchema.default(defaultRules),
        })
        .parse(data);
      const game =
        input.game === "any" ? games[randomInt(games.length)] : input.game;
      await this.locked(id, input.target, async (sql) => {
        await this.assertFriend(id, input.target, sql);
        if (
          !this.runtime.available(id) ||
          !this.runtime.available(input.target)
        )
          throw Error(
            "Both players must be online and out of matchmaking or a match.",
          );
        const prefs = await this.settings(input.target, sql);
        if (!prefs.challenges)
          throw Error("Your friend has paused challenges.");
        if (
          input.rules.spectators &&
          (!watchableGames.includes(game) ||
            !prefs.spectators ||
            !(await this.settings(id, sql)).spectators)
        )
          throw Error(
            "Spectators require a supported game and permission from both players.",
          );
        await sql.query(
          "UPDATE social_challenges SET status='expired' WHERE status='pending' AND expires_at<=now()",
        );
        const recent = (
          await sql.query(
            "SELECT 1 FROM social_challenges WHERE ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1)) AND (status='pending' OR created_at>now()-interval '10 seconds')",
            [id, input.target],
          )
        ).rows;
        if (recent.length)
          throw Error("An invite is pending or was just sent. Wait a moment.");
        await this.limit(id, "challenges", 10, 60, sql);
        await sql.query(
          "INSERT INTO social_challenges(id,from_id,to_id,game,rules,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '60 seconds')",
          [randomUUID(), id, input.target, game, JSON.stringify(input.rules)],
        );
      });
      this.changed(id, input.target);
      await this.notice(
        input.target,
        `${me.username} challenged you to a duel.`,
        "challenge",
        id,
      );
      return {};
    });
    event("social:challenge:respond", async (data) => {
      const { challengeId, accept } = z
        .object({ challengeId: z.string().uuid(), accept: z.boolean() })
        .parse(data);
      const c = (
        await this.db.query<SocialChallenge>(
          "SELECT * FROM social_challenges WHERE id=$1 AND to_id=$2",
          [challengeId, id],
        )
      ).rows[0];
      if (!c) throw Error("Invitation unavailable.");
      await this.locked(id, c.from_id, async (sql) => {
        await this.assertFriend(id, c.from_id, sql);
        const rows = (
          await sql.query(
            "UPDATE social_challenges SET status=$1 WHERE id=$2 AND status='pending' AND expires_at>now() RETURNING id",
            [accept ? "accepted" : "declined", challengeId],
          )
        ).rows;
        if (!rows.length)
          throw Error("This invitation expired or was already answered.");
        if (
          accept &&
          (!this.runtime.available(id) || !this.runtime.available(c.from_id))
        )
          throw Error(
            "A player is offline or busy. Try a new challenge when both are ready.",
          );
        if (
          accept &&
          c.rules.spectators &&
          (!(await this.settings(id, sql)).spectators ||
            !(await this.settings(c.from_id, sql)).spectators)
        )
          throw Error("Spectator permission changed. Send a new invitation.");
      });
      if (accept) {
        try {
          const match = await this.runtime.start(
            [c.from_id, id],
            c.game,
            c.rules,
          );
          await this.db.query(
            "UPDATE social_challenges SET match_id=$1 WHERE id=$2",
            [match.state.id, c.id],
          );
        } catch (error) {
          await this.db.query(
            "UPDATE social_challenges SET status='cancelled' WHERE id=$1",
            [c.id],
          );
          this.changed(id, c.from_id);
          throw error;
        }
      } else
        await this.notice(
          c.from_id,
          `${me.username} declined your challenge.`,
          "challenge",
          id,
        );
      this.changed(id, c.from_id);
      return {};
    });
    event("social:challenge:cancel", async (data) => {
      const { challengeId } = z
        .object({ challengeId: z.string().uuid() })
        .parse(data);
      const rows = (
        await this.db.query<{ to_id: string }>(
          "UPDATE social_challenges SET status='cancelled' WHERE id=$1 AND from_id=$2 AND status='pending' RETURNING to_id",
          [challengeId, id],
        )
      ).rows;
      if (!rows.length) throw Error("This invitation is no longer pending.");
      this.changed(id, rows[0].to_id);
      return {};
    });
    event("social:watch", async (data) => {
      const { target } = targetSchema.parse(data);
      const inLobby =
        (
          await this.db.query(
            "SELECT 1 FROM party_members a JOIN party_members b ON a.party_id=b.party_id WHERE a.user_id=$1 AND b.user_id=$2 AND a.role='spectator' AND b.role='player'",
            [id, target],
          )
        ).rows.length > 0;
      if (!inLobby) await this.assertFriend(id, target);
      if (!this.runtime.available(id))
        throw Error("Leave your match or queue before watching.");
      const match = this.runtime.matches.get(
        this.runtime.active.get(target) || "",
      );
      if (!match || !(await this.presence(target)).watchable)
        throw Error("This match is not available to spectators.");
      for (const p of match.state.players)
        if (
          (await this.blocked(id, p.id)) ||
          !(await this.settings(p.id)).spectators ||
          !(await this.settings(p.id)).presence
        )
          throw Error("This match is private.");
      if (
        [...this.watching.values()].filter((mid) => mid === match.state.id)
          .length >= 20
      )
        throw Error("This spectator room is full.");
      this.watching.set(id, match.state.id);
      return { state: match.snapshot() };
    });
    event("social:unwatch", async () => {
      this.watching.delete(id);
      return {};
    });
  }
}
