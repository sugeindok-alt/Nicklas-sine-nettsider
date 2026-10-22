import { Parties, partySchema, type PartyRuntime } from "./party";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { games, type Game } from "../lib/shared";
import { defaultPreferences, type Preferences } from "../lib/platform";
import type { Socket } from "socket.io";
import type { Database, SQL } from "./db";
export const platformSchema =
  `
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS media_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cosmetic TEXT NOT NULL DEFAULT 'graphite';
CREATE TABLE IF NOT EXISTS weekly_rewards(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,week TEXT NOT NULL,goal TEXT NOT NULL,PRIMARY KEY(user_id,week,goal));
CREATE TABLE IF NOT EXISTS rank_history(user_id TEXT REFERENCES users(id) ON DELETE CASCADE,match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,season_id TEXT NOT NULL,rating INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,match_id));
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,body TEXT NOT NULL,target TEXT,dedupe TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ,UNIQUE(user_id,dedupe));
CREATE TABLE IF NOT EXISTS player_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,preferences JSONB NOT NULL);
CREATE INDEX IF NOT EXISTS notification_owner ON notifications(user_id,created_at DESC);
` + partySchema;
export async function putNotification(
  sql: SQL,
  id: string,
  kind: string,
  body: string,
  target?: string,
  dedupe?: string,
) {
  await sql.query(
    "INSERT INTO notifications(id,user_id,kind,body,target,dedupe) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,dedupe) DO NOTHING",
    [randomUUID(), id, kind, body, target || null, dedupe || null],
  );
}
type Event = (name: string, fn: (data: unknown) => Promise<unknown>) => void;
export class Platform {
  parties?: Parties;
  attach(runtime: PartyRuntime) {
    this.parties = new Parties(this.db, this.sockets, runtime);
  }
  constructor(
    private db: Database,
    private sockets: Map<string, Socket>,
  ) {}
  changed(id: string) {
    this.sockets.get(id)?.emit("platform:changed");
  }
  async preferences(id: string): Promise<Preferences> {
    return {
      ...defaultPreferences,
      ...(
        await this.db.query<{ preferences: Preferences }>(
          "SELECT preferences FROM player_preferences WHERE user_id=$1",
          [id],
        )
      ).rows[0]?.preferences,
    };
  }
  async state(id: string) {
    return {
      notifications: (
        await this.db.query(
          "SELECT id,kind,body,target,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [id],
        )
      ).rows,
      unread: (
        await this.db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL",
          [id],
        )
      ).rows[0].n,
      preferences: await this.preferences(id),
      ...((await this.parties?.state(id)) || {
        party: null,
        invitations: [],
        tournamentInvitations: [],
      }),
    };
  }
  bind(socket: Socket, event: Event) {
    const id = socket.data.player.id as string;
    this.parties?.bind(socket, event);
    event("platform:state", async () => ({ platform: await this.state(id) }));
    event("preferences:save", async (data) => {
      const prefs = z
        .object({
          favorites: z.array(z.enum(games)).max(games.length),
          excluded: z.array(z.enum(games)).max(games.length - 1),
        })
        .parse(data);
      const value = {
        favorites: [...new Set(prefs.favorites)],
        excluded: [...new Set(prefs.excluded)],
      };
      await this.db.query(
        "INSERT INTO player_preferences VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET preferences=$2",
        [id, JSON.stringify(value)],
      );
      this.changed(id);
      return { preferences: value };
    });
    event("notifications:read", async (data) => {
      const { ids } = z
        .object({ ids: z.array(z.string().uuid()).max(100).optional() })
        .parse(data);
      await this.db.query(
        "UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL" +
          (ids ? " AND id=ANY($2)" : ""),
        ids ? [id, ids] : [id],
      );
      this.changed(id);
      return {};
    });
  }
}
