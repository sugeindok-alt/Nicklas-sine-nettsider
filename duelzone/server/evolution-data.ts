import type { Database, SQL } from "./db";
import type { MatchState, Game } from "../lib/shared";
import { dailyConfig } from "../lib/daily";
export const evolutionSchema = `
CREATE TABLE IF NOT EXISTS activity_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,game TEXT,score INTEGER,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS activity_recent ON activity_events(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,match_id TEXT REFERENCES matches(id),kind TEXT NOT NULL,game TEXT,rating INTEGER,body TEXT NOT NULL,steps TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'open',created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS feedback_owner ON feedback(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS daily_attempts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,version INTEGER NOT NULL,seed BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'active',score INTEGER NOT NULL DEFAULT 0,hits INTEGER NOT NULL DEFAULT 0,shots INTEGER NOT NULL DEFAULT 0,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS daily_attempts_board ON daily_attempts(day,status,score DESC);
CREATE INDEX IF NOT EXISTS daily_attempts_user ON daily_attempts(user_id,day);
CREATE TABLE IF NOT EXISTS game_mastery(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,game TEXT NOT NULL,xp INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,game));
CREATE TABLE IF NOT EXISTS mastery_events(match_id TEXT NOT NULL REFERENCES matches(id),user_id TEXT NOT NULL REFERENCES users(id),game TEXT NOT NULL,opponent_id TEXT NOT NULL,day TEXT NOT NULL,xp INTEGER NOT NULL,PRIMARY KEY(match_id,user_id));
CREATE INDEX IF NOT EXISTS mastery_daily ON mastery_events(user_id,day,game);
CREATE TABLE IF NOT EXISTS training_runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,game TEXT NOT NULL,difficulty TEXT NOT NULL,score INTEGER NOT NULL,opponent_score INTEGER NOT NULL,won BOOLEAN NOT NULL,finished_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS training_user ON training_runs(user_id,finished_at DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mastery_badge TEXT NOT NULL DEFAULT '';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS capacity INTEGER NOT NULL DEFAULT 4;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE entrants ADD COLUMN IF NOT EXISTS ready BOOLEAN NOT NULL DEFAULT false;
UPDATE entrants SET ready=false WHERE tournament_id IN(SELECT id FROM tournaments WHERE status='open');
UPDATE daily_attempts SET status='abandoned' WHERE status='active';
`;
export async function dailyOverview(db: SQL, id?: string) {
  const config = dailyConfig();
  const board = (
    await db.query(
      `SELECT b.*,u.username FROM (SELECT DISTINCT ON(user_id) user_id,day,score,hits,shots,finished_at FROM daily_attempts WHERE day=$1 AND status='finished' ORDER BY user_id,score DESC,hits DESC,finished_at ASC) b JOIN users u ON u.id=b.user_id ORDER BY score DESC,hits DESC,finished_at ASC LIMIT 50`,
      [config.day],
    )
  ).rows;
  const personal = id
    ? (
        await db.query(
          "SELECT user_id,day,score,hits,shots,finished_at FROM daily_attempts WHERE user_id=$1 AND day=$2 AND status='finished' ORDER BY score DESC,hits DESC,finished_at ASC LIMIT 1",
          [id, config.day],
        )
      ).rows[0] || null
    : null;
  const history = id
    ? (
        await db.query(
          "SELECT DISTINCT ON(day) user_id,day,score,hits,shots,finished_at FROM daily_attempts WHERE user_id=$1 AND status='finished' ORDER BY day DESC,score DESC,hits DESC,finished_at ASC LIMIT 14",
          [id],
        )
      ).rows
    : [];
  const attempts = id
    ? (
        await db.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM daily_attempts WHERE user_id=$1 AND day=$2",
          [id, config.day],
        )
      ).rows[0].count
    : 0;
  return {
    config,
    resetAt: new Date(Date.parse(config.day) + 86400000).toISOString(),
    board,
    history,
    personal,
    attempts,
  };
}
export async function awardMastery(sql: SQL, state: MatchState) {
  if (state.reason !== "Score" || state.mode === "ai" || state.mode === "ghost")
    return;
  for (const player of [...state.players].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (
      !Number.isFinite(state.scores[player.id]) ||
      state.scores[player.id] <= 0 ||
      (state.game === "showdown" &&
        !state.frontier?.history.some((round) => round.scores[player.id] > 0))
    )
      continue;
    const day = new Date().toISOString().slice(0, 10),
      other = state.players.find((p) => p.id !== player.id)!;
    await sql.query(
      "INSERT INTO game_mastery(user_id,game) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [player.id, state.game],
    );
    await sql.query(
      "SELECT xp FROM game_mastery WHERE user_id=$1 AND game=$2 FOR UPDATE",
      [player.id, state.game],
    );
    const count = (
      await sql.query<{ total: number; rival: number }>(
        "SELECT count(*)::int AS total,count(*) FILTER(WHERE opponent_id=$4)::int AS rival FROM mastery_events WHERE user_id=$1 AND game=$2 AND day=$3 AND xp>0",
        [player.id, state.game, day, other.id],
      )
    ).rows[0];
    const xp =
      count.total < 5 && count.rival < 2
        ? 35 + (state.winner === player.id ? 15 : 0)
        : 0;
    const claimed = await sql.query(
      "INSERT INTO mastery_events(match_id,user_id,game,opponent_id,day,xp) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING match_id",
      [state.id, player.id, state.game, other.id, day, xp],
    );
    if (claimed.rows.length)
      await sql.query(
        "UPDATE game_mastery SET xp=xp+$3 WHERE user_id=$1 AND game=$2",
        [player.id, state.game, xp],
      );
  }
}
export async function masteryProfile(sql: SQL, id: string) {
  return (
    await sql.query<{
      game: Game;
      xp: number;
      played: number;
      wins: number;
      best: number;
    }>(
      `SELECT m.game,COALESCE(g.xp,0)::int AS xp,count(*)::int AS played,count(*) FILTER(WHERE m.winner_id=$1)::int AS wins,MAX(r.score)::int AS best FROM results r JOIN matches m ON m.id=r.match_id LEFT JOIN game_mastery g ON g.user_id=r.user_id AND g.game=m.game WHERE r.user_id=$1 AND m.status='finished' AND m.reason='Score' GROUP BY m.game,g.xp ORDER BY COALESCE(g.xp,0) DESC,count(*) DESC`,
      [id],
    )
  ).rows;
}
export async function trainingHistory(db: Database, id: string) {
  const recent = (
    await db.query(
      "SELECT * FROM training_runs WHERE user_id=$1 ORDER BY finished_at DESC LIMIT 30",
      [id],
    )
  ).rows;
  const records = (
    await db.query(
      "SELECT game,difficulty,count(*)::int AS attempts,max(score)::int AS best,round(avg(score))::int AS average FROM training_runs WHERE user_id=$1 GROUP BY game,difficulty ORDER BY game,difficulty",
      [id],
    )
  ).rows;
  return { recent, records };
}

export async function activityFeed(sql: SQL, id: string) {
  return (
    await sql.query(
      "SELECT e.id,e.kind,e.game,e.score,e.created_at,u.id AS user_id,u.username,u.accent FROM activity_events e JOIN users u ON u.id=e.user_id JOIN friendships f ON f.status='accepted' AND ((f.a=$1 AND f.b=e.user_id) OR (f.b=$1 AND f.a=e.user_id)) JOIN social_settings s ON s.user_id=e.user_id WHERE s.settings->>'activity'='true' AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.owner_id=$1 AND b.target_id=e.user_id) OR (b.target_id=$1 AND b.owner_id=e.user_id)) ORDER BY e.created_at DESC LIMIT 20",
      [id],
    )
  ).rows;
}
export async function recordActivity(sql: SQL, state: MatchState) {
  if (state.reason !== "Score" || state.mode === "ai" || state.mode === "ghost")
    return;
  for (const p of state.players) {
    if (state.winner === p.id)
      await sql.query(
        "INSERT INTO activity_events(id,user_id,kind,game,score) VALUES($1,$2,'win',$3,$4) ON CONFLICT DO NOTHING",
        [state.id + ":" + p.id + ":win", p.id, state.game, state.scores[p.id]],
      );
    const previous = (
      await sql.query<{ best: number | null }>(
        "SELECT max(r.score)::int AS best FROM results r JOIN matches m ON m.id=r.match_id WHERE r.user_id=$1 AND m.game=$2 AND m.status='finished' AND m.reason='Score' AND m.id<>$3",
        [p.id, state.game, state.id],
      )
    ).rows[0].best;
    if (previous !== null && state.scores[p.id] > previous)
      await sql.query(
        "INSERT INTO activity_events(id,user_id,kind,game,score) VALUES($1,$2,'record',$3,$4) ON CONFLICT DO NOTHING",
        [
          state.id + ":" + p.id + ":record",
          p.id,
          state.game,
          state.scores[p.id],
        ],
      );
  }
}
