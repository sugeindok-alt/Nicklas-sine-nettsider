import { randomUUID, randomInt } from "node:crypto";
import { z } from "zod";
import type { Socket } from "socket.io";
import type { Database, SQL } from "./db";
import { games, type Game } from "../lib/shared";
import {
  defaultRules,
  watchableGames,
  type MatchRules,
  type Privacy,
} from "../lib/social";
export const partySchema = `
CREATE TABLE IF NOT EXISTS parties(id TEXT PRIMARY KEY,host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,game TEXT NOT NULL DEFAULT 'any',rules JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS party_members(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,ready BOOLEAN NOT NULL DEFAULT false,joined_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS party_members_room ON party_members(party_id);
CREATE TABLE IF NOT EXISTS party_invites(id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS party_invite_pair ON party_invites(party_id,to_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS tournament_invites(id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS tournament_invite_pair ON tournament_invites(tournament_id,to_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS player_reports(id TEXT PRIMARY KEY,reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,message_id TEXT REFERENCES private_messages(id) ON DELETE SET NULL,reason TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS report_duplicate ON player_reports(reporter_id,target_id,reason) WHERE status='open';
ALTER TABLE party_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE parties ADD COLUMN IF NOT EXISTS match_id TEXT;
CREATE TABLE IF NOT EXISTS party_messages(id TEXT PRIMARY KEY,party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS party_messages_room ON party_messages(party_id,created_at DESC);
UPDATE party_members SET ready=false;
`;
type Event = (name: string, fn: (data: unknown) => Promise<unknown>) => void;
type Row = {
  id: string;
  host_id: string;
  game: Game | "any";
  rules: MatchRules;
};
export type PartyRuntime = {
  available: (id: string) => boolean;
  friend: (a: string, b: string, sql?: SQL) => Promise<void>;
  settings: (id: string, sql?: SQL) => Promise<Privacy>;
  blocked: (a: string, b: string, sql?: SQL) => Promise<boolean>;
  revokeSpectators: (ids: string[]) => void;
  start: (ids: string[], game: Game, rules: MatchRules) => Promise<unknown>;
};
const rules = z.object({
  draft: z.boolean().optional(),
  length: z.enum(["quick", "standard", "extended"]),
  spectators: z.boolean(),
});
export class Parties {
  private starting = new Set<string>();
  constructor(
    private db: Database,
    private sockets: Map<string, Socket>,
    private runtime: PartyRuntime,
  ) {}
  changed(...ids: string[]) {
    for (const id of new Set(ids))
      this.sockets.get(id)?.emit("platform:changed");
  }
  async state(id: string) {
    const party = (
      await this.db.query<Row>(
        "SELECT p.* FROM parties p JOIN party_members m ON m.party_id=p.id WHERE m.user_id=$1",
        [id],
      )
    ).rows[0];
    const members = party
      ? (
          await this.db.query<{
            id: string;
            username: string;
            accent: string;
            ready: boolean;
            role: "player" | "spectator";
          }>(
            "SELECT u.id,u.username,u.accent,m.ready,m.role FROM party_members m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1 ORDER BY m.joined_at",
            [party.id],
          )
        ).rows
      : [];
    return {
      party: party
        ? {
            ...party,
            watching:
              (
                await this.db.query(
                  "SELECT m.id FROM matches m JOIN parties p ON p.match_id=m.id WHERE p.id=$1 AND m.status='active' AND p.rules->>'spectators'='true'",
                  [party.id],
                )
              ).rows.length > 0,
            messages: (
              await this.db.query(
                "SELECT m.id,m.body,m.created_at,u.username FROM party_messages m JOIN users u ON u.id=m.user_id WHERE m.party_id=$1 ORDER BY m.created_at DESC LIMIT 30",
                [party.id],
              )
            ).rows.reverse(),
            members: await Promise.all(
              members.map(async (m) => ({
                ...m,
                online:
                  this.sockets.has(m.id) &&
                  (await this.runtime.settings(m.id)).presence,
              })),
            ),
          }
        : null,
      invitations: (
        await this.db.query(
          "SELECT i.id,i.party_id,u.username AS sender,i.expires_at FROM party_invites i JOIN users u ON u.id=i.from_id WHERE i.to_id=$1 AND i.status='pending' AND i.expires_at>now() ORDER BY i.created_at DESC",
          [id],
        )
      ).rows,
      tournamentInvitations: (
        await this.db.query(
          "SELECT i.id,i.tournament_id,t.name,t.game,u.username AS sender,i.expires_at FROM tournament_invites i JOIN tournaments t ON t.id=i.tournament_id JOIN users u ON u.id=i.from_id WHERE i.to_id=$1 AND i.status='pending' AND i.expires_at>now() AND t.status='open' ORDER BY i.created_at DESC",
          [id],
        )
      ).rows,
    };
  }
  private async room(sql: SQL, id: string, host = false) {
    const p = (
      await sql.query<Row>(
        "SELECT p.* FROM parties p JOIN party_members m ON m.party_id=p.id WHERE m.user_id=$1 FOR UPDATE OF p",
        [id],
      )
    ).rows[0];
    if (!p || (host && p.host_id !== id))
      throw Error(
        host ? "Only the party host can do that." : "Join a party first.",
      );
    if (this.starting.has(p.id)) throw Error("Your party match is starting.");
    return p;
  }
  private async members(sql: SQL, party: string) {
    return (
      await sql.query<{
        user_id: string;
        ready: boolean;
        role: "player" | "spectator";
      }>(
        "SELECT user_id,ready,role FROM party_members WHERE party_id=$1 ORDER BY joined_at",
        [party],
      )
    ).rows;
  }
  private async limit(
    sql: SQL,
    id: string,
    kind: string,
    max = 10,
    seconds = 60,
  ) {
    const row = (
      await sql.query<{ count: number }>(
        "INSERT INTO social_limits(user_id,kind) VALUES($1,$2) ON CONFLICT(user_id,kind) DO UPDATE SET count=CASE WHEN social_limits.started_at<now()-($3*interval '1 second') THEN 1 ELSE social_limits.count+1 END,started_at=CASE WHEN social_limits.started_at<now()-($3*interval '1 second') THEN now() ELSE social_limits.started_at END RETURNING count",
        [id, kind, seconds],
      )
    ).rows[0];
    if (row.count > max)
      throw Error("Too many attempts. Please wait before trying again.");
  }
  async disconnected(id: string) {
    await this.db.query(
      "UPDATE party_members SET ready=false WHERE user_id=$1",
      [id],
    );
    const rows = (
      await this.db.query<{ user_id: string }>(
        "SELECT user_id FROM party_members WHERE party_id=(SELECT party_id FROM party_members WHERE user_id=$1)",
        [id],
      )
    ).rows;
    this.changed(...rows.map((r) => r.user_id));
  }
  async invalidate(a: string, b: string) {
    const party = (
      await this.db.query<{ party_id: string }>(
        "SELECT x.party_id FROM party_members x JOIN party_members y ON y.party_id=x.party_id WHERE x.user_id=$1 AND y.user_id=$2",
        [a, b],
      )
    ).rows[0];
    if (party) {
      const peers = await this.members(this.db, party.party_id);
      await this.db.query("DELETE FROM parties WHERE id=$1", [party.party_id]);
      this.changed(...peers.map((p) => p.user_id));
    }
    await this.db.query(
      "UPDATE party_invites SET status='cancelled' WHERE status='pending' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))",
      [a, b],
    );
    await this.db.query(
      "UPDATE tournament_invites SET status='cancelled' WHERE status='pending' AND ((from_id=$1 AND to_id=$2) OR (from_id=$2 AND to_id=$1))",
      [a, b],
    );
    this.changed(a, b);
  }
  bind(socket: Socket, event: Event) {
    const id = socket.data.player.id as string,
      name = socket.data.player.username as string;
    event("party:create", async () => {
      if (!this.runtime.available(id))
        throw Error("Leave your queue or match before creating a party.");
      await this.db.transaction(async (sql) => {
        await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
        if (
          (
            await sql.query("SELECT 1 FROM party_members WHERE user_id=$1", [
              id,
            ])
          ).rows.length
        )
          throw Error("You already belong to a party.");
        const party = randomUUID();
        await sql.query(
          "INSERT INTO parties(id,host_id,rules) VALUES($1,$2,$3)",
          [party, id, JSON.stringify(defaultRules)],
        );
        await sql.query(
          "INSERT INTO party_members(user_id,party_id) VALUES($1,$2)",
          [id, party],
        );
      });
      this.changed(id);
      return {};
    });
    event("party:invite", async (data) => {
      const { target } = z.object({ target: z.string().uuid() }).parse(data);
      await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id, true);
        await this.runtime.friend(id, target, sql);
        if (!this.runtime.available(id) || !this.runtime.available(target))
          throw Error("Both players must be online and free.");
        if (!(await this.runtime.settings(target, sql)).challenges)
          throw Error("Your friend has paused invitations.");
        if ((await this.members(sql, p.id)).length >= 8)
          throw Error("This eight-person lobby is full.");
        if (
          (
            await sql.query("SELECT 1 FROM party_members WHERE user_id=$1", [
              target,
            ])
          ).rows.length
        )
          throw Error("Your friend is already in a party.");
        await this.limit(sql, id, "party");
        await sql.query(
          "UPDATE party_invites SET status='expired' WHERE expires_at<=now() AND status='pending'",
        );
        if (
          (
            await sql.query(
              "SELECT 1 FROM party_invites WHERE party_id=$1 AND to_id=$2 AND (status='pending' OR created_at>now()-interval '10 seconds')",
              [p.id, target],
            )
          ).rows.length
        )
          throw Error("An invitation was already sent.");
        await sql.query(
          "INSERT INTO party_invites(id,party_id,from_id,to_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 seconds')",
          [randomUUID(), p.id, id, target],
        );
      });
      await this.db.notify(
        target,
        "party",
        name + " invited you to a private party.",
        id,
      );
      this.changed(id, target);
      return {};
    });
    event("party:respond", async (data) => {
      const { inviteId, accept } = z
        .object({ inviteId: z.string().uuid(), accept: z.boolean() })
        .parse(data);
      let host = "";
      await this.db.transaction(async (sql) => {
        const invite = (
          await sql.query<{ party_id: string; from_id: string }>(
            "SELECT party_id,from_id FROM party_invites WHERE id=$1 AND to_id=$2 AND status='pending' AND expires_at>now()",
            [inviteId, id],
          )
        ).rows[0];
        if (!invite) throw Error("That party invitation has expired.");
        host = invite.from_id;
        const p = (
          await sql.query<Row>("SELECT * FROM parties WHERE id=$1 FOR UPDATE", [
            invite.party_id,
          ])
        ).rows[0];
        if (!p) throw Error("The party has closed.");
        await this.runtime.friend(id, host, sql);
        if (accept) {
          if (!(await this.runtime.settings(id, sql)).challenges)
            throw Error("Enable friend invitations in Privacy to join.");
          if (!this.runtime.available(id) || !this.runtime.available(host))
            throw Error("Both players must be online and free.");
          const existing = await this.members(sql, p.id);
          if (existing.length >= 8) throw Error("This party is full.");
          if (
            (
              await sql.query("SELECT 1 FROM party_members WHERE user_id=$1", [
                id,
              ])
            ).rows.length
          )
            throw Error("Leave your existing party first.");
          for (const m of existing)
            if (await this.runtime.blocked(id, m.user_id, sql))
              throw Error("This lobby is unavailable.");
          await sql.query(
            "INSERT INTO party_members(user_id,party_id,role) VALUES($1,$2,$3)",
            [
              id,
              p.id,
              existing.filter((m) => m.role === "player").length < 2
                ? "player"
                : "spectator",
            ],
          );
          await sql.query(
            "UPDATE party_members SET ready=false WHERE party_id=$1",
            [p.id],
          );
        }
        const claim = await sql.query(
          "UPDATE party_invites SET status=$1 WHERE id=$2 AND status='pending' RETURNING id",
          [accept ? "accepted" : "declined", inviteId],
        );
        if (!claim.rows.length)
          throw Error("This invitation was already answered.");
      });
      const roomPeers = (
        await this.db.query<{ user_id: string }>(
          "SELECT user_id FROM party_members WHERE party_id=(SELECT party_id FROM party_members WHERE user_id=$1)",
          [id],
        )
      ).rows;
      this.changed(id, host, ...roomPeers.map((p) => p.user_id));
      return {};
    });
    event("party:configure", async (data) => {
      const input = z
        .object({ game: z.union([z.enum(games), z.literal("any")]), rules })
        .parse(data);
      const peers = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id, true);
        if (
          (await this.members(sql, p.id)).some(
            (m) => m.role === "player" && !this.runtime.available(m.user_id),
          )
        )
          throw Error("Wait until the current match or search finishes.");
        if (
          input.rules.spectators &&
          (input.game === "any" || !watchableGames.includes(input.game))
        )
          throw Error("Choose a supported game to allow spectators.");
        await sql.query("UPDATE parties SET game=$1,rules=$2 WHERE id=$3", [
          input.game,
          JSON.stringify(input.rules),
          p.id,
        ]);
        await sql.query(
          "UPDATE party_members SET ready=false WHERE party_id=$1",
          [p.id],
        );
        return this.members(sql, p.id);
      });
      this.changed(...peers.map((p) => p.user_id));
      return {};
    });
    event("party:seat", async (data) => {
      const { target, role } = z
        .object({
          target: z.string().uuid(),
          role: z.enum(["player", "spectator"]),
        })
        .parse(data);
      const peers = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id, true),
          members = await this.members(sql, p.id);
        if (!members.some((m) => m.user_id === target))
          throw Error("Player is not in this lobby.");
        if (
          members.some(
            (m) => m.role === "player" && !this.runtime.available(m.user_id),
          )
        )
          throw Error("Wait until the current match or search finishes.");
        if (
          role === "player" &&
          members.filter((m) => m.role === "player" && m.user_id !== target)
            .length >= 2
        )
          throw Error(
            "Move a player to a spectator seat first. Games remain 1v1.",
          );
        await sql.query(
          "UPDATE party_members SET role=$1 WHERE user_id=$2 AND party_id=$3",
          [role, target, p.id],
        );
        await sql.query(
          "UPDATE party_members SET ready=false WHERE party_id=$1",
          [p.id],
        );
        return members;
      });
      this.runtime.revokeSpectators(peers.map((p) => p.user_id));
      this.changed(...peers.map((p) => p.user_id));
      return {};
    });
    event("party:message", async (data) => {
      const input = z
        .object({
          id: z.string().uuid(),
          body: z.string().trim().min(1).max(600),
        })
        .parse(data);
      const peers = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id);
        await this.limit(sql, id, "party-message", 15);
        await sql.query(
          "INSERT INTO party_messages(id,party_id,user_id,body) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [input.id, p.id, id, input.body],
        );
        await sql.query(
          "DELETE FROM party_messages WHERE party_id=$1 AND id NOT IN(SELECT id FROM party_messages WHERE party_id=$1 ORDER BY created_at DESC LIMIT 100)",
          [p.id],
        );
        return this.members(sql, p.id);
      });
      this.changed(...peers.map((p) => p.user_id));
      return {};
    });
    event("party:ready", async (data) => {
      const { ready } = z.object({ ready: z.boolean() }).parse(data);
      const peers = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id);
        if (ready && !this.runtime.available(id))
          throw Error("Finish your queue or match first.");
        await sql.query("UPDATE party_members SET ready=$1 WHERE user_id=$2", [
          ready,
          id,
        ]);
        return this.members(sql, p.id);
      });
      this.changed(...peers.map((p) => p.user_id));
      return {};
    });
    event("party:launch", async () => {
      const claimed = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id, true),
          everyone = await this.members(sql, p.id),
          members = everyone.filter((m) => m.role === "player");
        if (
          members.length !== 2 ||
          members.some((m) => !m.ready || !this.runtime.available(m.user_id))
        )
          throw Error("Both party members must be online, free and ready.");
        for (const m of members)
          if (m.user_id !== p.host_id)
            await this.runtime.friend(p.host_id, m.user_id, sql);
        if (
          await this.runtime.blocked(
            members[0].user_id,
            members[1].user_id,
            sql,
          )
        )
          throw Error("These players cannot be matched.");
        if (p.rules.spectators)
          for (const m of members)
            if (!(await this.runtime.settings(m.user_id, sql)).spectators)
              throw Error("Both players must allow spectators.");
        this.starting.add(p.id);
        await sql.query(
          "UPDATE party_members SET ready=false WHERE party_id=$1",
          [p.id],
        );
        return {
          p,
          ids: members.map((m) => m.user_id),
          everyone: everyone.map((m) => m.user_id),
        };
      });
      try {
        const launched = (await this.runtime.start(
          claimed.ids,
          claimed.p.game === "any"
            ? games[randomInt(games.length)]
            : claimed.p.game,
          claimed.p.rules,
        )) as { state?: { id?: string } } | undefined;
        if (launched?.state?.id)
          await this.db.query("UPDATE parties SET match_id=$1 WHERE id=$2", [
            launched.state.id,
            claimed.p.id,
          ]);
      } finally {
        this.starting.delete(claimed.p.id);
        this.changed(...claimed.everyone);
      }
      return {};
    });
    event("party:leave", async () => {
      const peers = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id),
          members = await this.members(sql, p.id);
        if (p.host_id === id)
          await sql.query("DELETE FROM parties WHERE id=$1", [p.id]);
        else {
          await sql.query("DELETE FROM party_members WHERE user_id=$1", [id]);
          await sql.query(
            "UPDATE party_members SET ready=false WHERE party_id=$1",
            [p.id],
          );
        }
        return members;
      });
      this.runtime.revokeSpectators(peers.map((p) => p.user_id));
      this.changed(...peers.map((p) => p.user_id));
      return {};
    });
    event("party:remove", async (data) => {
      const { target } = z.object({ target: z.string().uuid() }).parse(data);
      if (target === id) throw Error("Use Leave party to close your party.");
      const peers = await this.db.transaction(async (sql) => {
        const p = await this.room(sql, id, true),
          members = await this.members(sql, p.id);
        if (!members.some((m) => m.user_id === target))
          throw Error("Player is not in your party.");
        await sql.query(
          "DELETE FROM party_members WHERE user_id=$1 AND party_id=$2",
          [target, p.id],
        );
        await sql.query(
          "UPDATE party_members SET ready=false WHERE party_id=$1",
          [p.id],
        );
        return members;
      });
      this.runtime.revokeSpectators(peers.map((p) => p.user_id));
      this.changed(...peers.map((p) => p.user_id));
      return {};
    });
    event("tournament:invite", async (data) => {
      const { target, tournamentId } = z
        .object({ target: z.string().uuid(), tournamentId: z.string().uuid() })
        .parse(data);
      let title = "";
      await this.db.transaction(async (sql) => {
        await this.runtime.friend(id, target, sql);
        if (!(await this.runtime.settings(target, sql)).challenges)
          throw Error("Your friend has paused invitations.");
        const t = (
          await sql.query<{ name: string; capacity: number }>(
            "SELECT t.name,t.capacity FROM tournaments t JOIN entrants e ON e.tournament_id=t.id AND e.user_id=$1 WHERE t.id=$2 AND t.status='open' FOR UPDATE OF t",
            [id, tournamentId],
          )
        ).rows[0];
        if (!t)
          throw Error("Join this open tournament before inviting friends.");
        title = t.name;
        const entries = (
          await sql.query<{ user_id: string }>(
            "SELECT user_id FROM entrants WHERE tournament_id=$1",
            [tournamentId],
          )
        ).rows;
        if (
          entries.length >= t.capacity ||
          entries.some((e) => e.user_id === target)
        )
          throw Error("The tournament is full or your friend already joined.");
        await this.limit(sql, id, "tournament-invites");
        await sql.query(
          "UPDATE tournament_invites SET status='expired' WHERE expires_at<=now() AND status='pending'",
        );
        if (
          (
            await sql.query(
              "SELECT 1 FROM tournament_invites WHERE tournament_id=$1 AND to_id=$2 AND (status='pending' OR created_at>now()-interval '10 seconds')",
              [tournamentId, target],
            )
          ).rows.length
        )
          throw Error("An invitation was already sent.");
        await sql.query(
          "INSERT INTO tournament_invites(id,tournament_id,from_id,to_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
          [randomUUID(), tournamentId, id, target],
        );
      });
      await this.db.notify(
        target,
        "tournament",
        name + " invited you to " + title + ".",
        tournamentId,
      );
      this.changed(id, target);
      return {};
    });
    event("tournament:respond", async (data) => {
      const { inviteId, accept } = z
        .object({ inviteId: z.string().uuid(), accept: z.boolean() })
        .parse(data);
      let sender = "";
      await this.db.transaction(async (sql) => {
        const i = (
          await sql.query<{ tournament_id: string; from_id: string }>(
            "SELECT tournament_id,from_id FROM tournament_invites WHERE id=$1 AND to_id=$2 AND status='pending' AND expires_at>now()",
            [inviteId, id],
          )
        ).rows[0];
        if (!i) throw Error("This invitation is no longer available.");
        sender = i.from_id;
        await this.runtime.friend(id, sender, sql);
        const t = (
          await sql.query<{ status: string; capacity: number }>(
            "SELECT status,capacity FROM tournaments WHERE id=$1 FOR UPDATE",
            [i.tournament_id],
          )
        ).rows[0];
        if (!t || t.status !== "open")
          throw Error("This tournament is no longer open.");
        if (accept) {
          if (!(await this.runtime.settings(id, sql)).challenges)
            throw Error("Enable friend invitations in Privacy to join.");
          const entries = (
            await sql.query<{ user_id: string }>(
              "SELECT user_id FROM entrants WHERE tournament_id=$1",
              [i.tournament_id],
            )
          ).rows;
          if (!entries.some((e) => e.user_id === id)) {
            if (entries.length >= t.capacity)
              throw Error("The tournament is full.");
            await sql.query(
              "INSERT INTO entrants(tournament_id,user_id) VALUES($1,$2)",
              [i.tournament_id, id],
            );
          }
        }
        const claim = await sql.query(
          "UPDATE tournament_invites SET status=$1 WHERE id=$2 AND status='pending' RETURNING id",
          [accept ? "accepted" : "declined", inviteId],
        );
        if (!claim.rows.length)
          throw Error("This invitation was already answered.");
      });
      this.changed(id, sender);
      for (const s of this.sockets.values()) s.emit("refresh");
      return {};
    });
    event("social:report", async (data) => {
      const input = z
        .object({
          target: z.string().uuid(),
          messageId: z.string().uuid().optional(),
          reason: z.enum(["harassment", "spam", "cheating", "other"]),
          details: z.string().trim().min(5).max(500),
        })
        .parse(data);
      if (id === input.target) throw Error("Choose another player.");
      const reportId = randomUUID();
      await this.db.transaction(async (sql) => {
        await sql.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
        await this.limit(sql, id, "reports", 5, 86400);
        if (
          !(await sql.query("SELECT id FROM users WHERE id=$1", [input.target]))
            .rows.length
        )
          throw Error("Player unavailable.");
        if (
          input.messageId &&
          !(
            await sql.query(
              "SELECT id FROM private_messages WHERE id=$1 AND from_id=$2 AND to_id=$3",
              [input.messageId, input.target, id],
            )
          ).rows.length
        )
          throw Error("You can only report messages sent to you.");
        const added = await sql.query(
          "INSERT INTO player_reports(id,reporter_id,target_id,message_id,reason,details) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(reporter_id,target_id,reason) WHERE status='open' DO NOTHING RETURNING id",
          [
            reportId,
            id,
            input.target,
            input.messageId || null,
            input.reason,
            input.details,
          ],
        );
        if (!added.rows.length)
          throw Error("You already have an open report for this issue.");
      });
      return { reportId };
    });
  }
}
