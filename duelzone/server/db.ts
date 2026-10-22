import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { elo, seasonAt, type Player, type MatchState } from "../lib/shared";
import { awardProgress, getProgress } from "./progression";
import { socialSchema } from "./social";

export interface SQL {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}
export class Database implements SQL {
  private embedded?: PGlite;
  private pool?: pg.Pool;
  constructor(
    url = process.env.DATABASE_URL,
    directory = process.env.DATA_DIR || resolve(".data/postgres"),
  ) {
    if (url)
      this.pool = new pg.Pool({
        connectionString: url,
        max: 5,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 15000,
      });
    else {
      if (directory !== "memory://") mkdirSync(directory, { recursive: true });
      this.embedded = new PGlite(directory);
    }
  }
  async query<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    if (this.pool)
      return {
        rows: (await this.pool.query(text, params)).rows as unknown as T[],
      };
    return this.embedded!.query<T>(text, params);
  }
  async transaction<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
    if (this.embedded) return this.embedded.transaction((tx) => fn(tx));
    const client = await this.pool!.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool?.end();
    await this.embedded?.close();
  }
  async init() {
    const schema = `
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, accent TEXT NOT NULL DEFAULT '#c8f36a', bio TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS seasons(id TEXT PRIMARY KEY,name TEXT NOT NULL,starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS ratings(user_id TEXT REFERENCES users(id),season_id TEXT REFERENCES seasons(id),rating INTEGER NOT NULL DEFAULT 1000,games INTEGER NOT NULL DEFAULT 0,wins INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,season_id));
    CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,game TEXT NOT NULL,mode TEXT NOT NULL,season_id TEXT REFERENCES seasons(id),status TEXT NOT NULL DEFAULT 'active',winner_id TEXT REFERENCES users(id),reason TEXT,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),ended_at TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS results(match_id TEXT REFERENCES matches(id),user_id TEXT REFERENCES users(id),score INTEGER NOT NULL DEFAULT 0,rating_change INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(match_id,user_id));
    CREATE INDEX IF NOT EXISTS result_user ON results(user_id);
    CREATE TABLE IF NOT EXISTS tournaments(id TEXT PRIMARY KEY,name TEXT NOT NULL,game TEXT NOT NULL,host_id TEXT REFERENCES users(id),status TEXT NOT NULL DEFAULT 'open',winner_id TEXT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS entrants(tournament_id TEXT REFERENCES tournaments(id),user_id TEXT REFERENCES users(id),joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(tournament_id,user_id));
    CREATE TABLE IF NOT EXISTS fixtures(tournament_id TEXT REFERENCES tournaments(id),round INTEGER NOT NULL,slot INTEGER NOT NULL,match_id TEXT REFERENCES matches(id),player_a TEXT REFERENCES users(id),player_b TEXT REFERENCES users(id),winner_id TEXT REFERENCES users(id),PRIMARY KEY(tournament_id,round,slot));
    CREATE TABLE IF NOT EXISTS progression(user_id TEXT PRIMARY KEY REFERENCES users(id),xp INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS achievements(user_id TEXT REFERENCES users(id),id TEXT NOT NULL,earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(user_id,id));
    CREATE TABLE IF NOT EXISTS daily_rewards(user_id TEXT REFERENCES users(id),day TEXT NOT NULL,goal TEXT NOT NULL,PRIMARY KEY(user_id,day,goal));
    CREATE TABLE IF NOT EXISTS reward_events(match_id TEXT REFERENCES matches(id),user_id TEXT REFERENCES users(id),day TEXT NOT NULL,PRIMARY KEY(match_id,user_id));
    CREATE INDEX IF NOT EXISTS reward_day ON reward_events(user_id,day);
    `;
    for (const statement of schema.split(";").filter((s) => s.trim()))
      await this.query(statement);
    for (const statement of socialSchema.split(";").filter((s) => s.trim()))
      await this.query(statement);
    await this.currentSeason();
    await this.query(
      "UPDATE matches SET status='abandoned',reason='Server restarted; no rating change',ended_at=now() WHERE status='active'",
    );
    await this.query(
      "UPDATE tournaments SET status='interrupted' WHERE status='running'",
    );
    await this.query("DELETE FROM sessions WHERE expires_at < now()");
  }
  async currentSeason() {
    const s = seasonAt();
    await this.query(
      "INSERT INTO seasons VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [s.id, s.name, s.start, s.end],
    );
    return s;
  }
  async player(id: string): Promise<Player | undefined> {
    return (
      await this.query<Player>(
        "SELECT id,username,accent,bio FROM users WHERE id=$1",
        [id],
      )
    ).rows[0];
  }
  async beginMatch(state: MatchState) {
    const season = await this.currentSeason();
    await this.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO matches(id,game,mode,season_id,rules) VALUES($1,$2,$3,$4,$5)",
        [
          state.id,
          state.game,
          state.mode,
          season.id,
          JSON.stringify(state.rules || {}),
        ],
      );
      for (const p of state.players)
        await tx.query("INSERT INTO results(match_id,user_id) VALUES($1,$2)", [
          state.id,
          p.id,
        ]);
    });
  }
  async finishMatch(state: MatchState) {
    return this.transaction(async (tx) => {
      const m = (
        await tx.query<{ status: string; season_id: string }>(
          "SELECT status,season_id FROM matches WHERE id=$1 FOR UPDATE",
          [state.id],
        )
      ).rows[0];
      if (!m || m.status !== "active") throw new Error("Match already settled");
      const changes: Record<string, number> = {};
      const [a, b] = state.players;
      if (state.mode === "ranked") {
        for (const p of state.players)
          await tx.query(
            "INSERT INTO ratings(user_id,season_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [p.id, m.season_id],
          );
        const rating = (
          await tx.query<{ user_id: string; rating: number }>(
            "SELECT user_id,rating FROM ratings WHERE season_id=$1 AND user_id IN ($2,$3) ORDER BY user_id FOR UPDATE",
            [m.season_id, a.id, b.id],
          )
        ).rows;
        const change = elo(
          rating.find((r) => r.user_id === a.id)!.rating,
          rating.find((r) => r.user_id === b.id)!.rating,
          state.winner === null ? 0.5 : state.winner === a.id ? 1 : 0,
        );
        changes[a.id] = Math.max(
          -rating.find((r) => r.user_id === a.id)!.rating,
          change,
        );
        changes[b.id] = Math.max(
          -rating.find((r) => r.user_id === b.id)!.rating,
          -change,
        );
        for (const p of state.players)
          await tx.query(
            "UPDATE ratings SET rating=GREATEST(0,rating+$1),games=games+1,wins=wins+$2 WHERE user_id=$3 AND season_id=$4",
            [changes[p.id], state.winner === p.id ? 1 : 0, p.id, m.season_id],
          );
      }
      await tx.query(
        "UPDATE matches SET status='finished',winner_id=$1,reason=$2,ended_at=now() WHERE id=$3",
        [state.winner, state.reason || "Score", state.id],
      );
      for (const p of state.players)
        await tx.query(
          "UPDATE results SET score=$1,rating_change=$2 WHERE match_id=$3 AND user_id=$4",
          [state.scores[p.id], changes[p.id] || 0, state.id, p.id],
        );
      state.rewards = await awardProgress(tx, state);
      return changes;
    });
  }
  async profile(id: string) {
    const player = await this.player(id);
    if (!player) return null;
    const season = await this.currentSeason();
    const rating = (
      await this.query(
        "SELECT rating,games,wins FROM ratings WHERE user_id=$1 AND season_id=$2",
        [id, season.id],
      )
    ).rows[0] || { rating: 1000, games: 0, wins: 0 };
    const history = (
      await this.query(
        `SELECT m.id,m.game,m.mode,m.status,m.winner_id,m.reason,m.ended_at,r.score,r.rating_change,u.username AS opponent,u.id AS opponent_id,other.score AS opponent_score FROM results r JOIN matches m ON m.id=r.match_id JOIN results other ON other.match_id=m.id AND other.user_id<>r.user_id JOIN users u ON u.id=other.user_id WHERE r.user_id=$1 AND m.status<>'active' ORDER BY m.ended_at DESC LIMIT 50`,
        [id],
      )
    ).rows;
    const stats = (
      await this.query(
        `SELECT COUNT(*)::int AS played,COUNT(*) FILTER(WHERE m.winner_id=$1)::int AS wins,COUNT(*) FILTER(WHERE m.winner_id IS NULL)::int AS draws,COALESCE(MAX(r.score),0)::int AS best FROM results r JOIN matches m ON m.id=r.match_id WHERE r.user_id=$1 AND m.status='finished'`,
        [id],
      )
    ).rows[0];
    const records = (
      await this.query(
        `SELECT m.game,MAX(r.score)::int AS best,COUNT(*)::int AS played,COUNT(*) FILTER(WHERE m.winner_id=$1)::int AS wins FROM results r JOIN matches m ON m.id=r.match_id WHERE r.user_id=$1 AND m.status='finished' GROUP BY m.game`,
        [id],
      )
    ).rows;
    return {
      player,
      rating,
      history,
      stats,
      records,
      progression: await getProgress(this, id),
    };
  }
  async tournaments() {
    const list = (
      await this.query(
        "SELECT t.*,u.username AS host,w.username AS winner FROM tournaments t JOIN users u ON u.id=t.host_id LEFT JOIN users w ON w.id=t.winner_id ORDER BY t.created_at DESC LIMIT 30",
      )
    ).rows;
    return Promise.all(
      list.map(async (t) => ({
        ...t,
        entrants: (
          await this.query(
            "SELECT u.id,u.username,u.accent FROM entrants e JOIN users u ON u.id=e.user_id WHERE tournament_id=$1 ORDER BY joined_at",
            [t.id],
          )
        ).rows,
        fixtures: (
          await this.query(
            "SELECT f.*,a.username AS name_a,b.username AS name_b,w.username AS winner FROM fixtures f JOIN users a ON a.id=f.player_a JOIN users b ON b.id=f.player_b LEFT JOIN users w ON w.id=f.winner_id WHERE tournament_id=$1 ORDER BY round,slot",
            [t.id],
          )
        ).rows,
      })),
    );
  }
}
export const newId = () => randomUUID();
