import type { SQL } from "./db";
import {
  ACHIEVEMENTS,
  dailyGame,
  dailyGoals,
  type Progression,
} from "../lib/progression";
import { featuredGames, type MatchState } from "../lib/shared";

export async function awardProgress(sql: SQL, state: MatchState) {
  if (state.reason !== "Score") return {};
  const day = new Date().toISOString().slice(0, 10),
    rewards: NonNullable<MatchState["rewards"]> = {};
  for (const player of state.players) {
    const id = player.id;
    await sql.query(
      "INSERT INTO progression(user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [id],
    );
    await sql.query(
      "SELECT user_id FROM progression WHERE user_id=$1 FOR UPDATE",
      [id],
    );
    const tally = (
      await sql.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM reward_events WHERE user_id=$1 AND day=$2",
        [id, day],
      )
    ).rows[0].count;
    const claimed = await sql.query(
      "INSERT INTO reward_events(match_id,user_id,day) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING match_id",
      [state.id, id, day],
    );
    if (!claimed.rows.length) continue;
    let xp = tally < 5 ? 50 + (state.winner === id ? 25 : 0) : 0;
    const daily = [
      "play",
      ...(state.game === dailyGame(day) ? ["featured"] : []),
      ...(state.winner === id ? ["win"] : []),
    ];
    const earnedDaily: string[] = [];
    for (const goal of daily) {
      const inserted = await sql.query(
        "INSERT INTO daily_rewards(user_id,day,goal) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING goal",
        [id, day, goal],
      );
      if (inserted.rows.length) {
        xp += 75;
        earnedDaily.push(goal);
      }
    }
    const stats = (
      await sql.query<{ game: string; wins: number }>(
        "SELECT m.game,COUNT(*) FILTER(WHERE m.winner_id=$1 AND m.mode='ranked' AND m.reason='Score')::int AS wins FROM results r JOIN matches m ON m.id=r.match_id WHERE r.user_id=$1 AND m.status='finished' AND m.reason='Score' GROUP BY m.game",
        [id],
      )
    ).rows;
    const c = state.competition,
      runner = c?.players[id];
    const candidates = [
      ...(state.winner === id ? ["first-win"] : []),
      ...(featuredGames.every((game) => stats.some((row) => row.game === game))
        ? ["versatile"]
        : []),
      ...(state.game === "dodge" && runner?.hp === 3 ? ["untouched"] : []),
      ...(state.game === "clash" && runner && runner.combo >= 8
        ? ["combo"]
        : []),
      ...(state.game === "grid" &&
      c &&
      c.tiles.filter((owner) => owner === id).length >= 20
        ? ["territory"]
        : []),
      ...(state.game === "mind" && runner?.combo === 6 ? ["memory"] : []),
      ...(state.game === "arena" && state.winner === id ? ["arena-win"] : []),
      ...(stats.reduce((sum, row) => sum + row.wins, 0) >= 10
        ? ["ten-wins"]
        : []),
    ];
    const earned: string[] = [];
    for (const achievement of candidates) {
      const inserted = await sql.query(
        "INSERT INTO achievements(user_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [id, achievement],
      );
      if (inserted.rows.length) {
        xp += 100;
        earned.push(achievement);
      }
    }
    await sql.query("UPDATE progression SET xp=xp+$1 WHERE user_id=$2", [
      xp,
      id,
    ]);
    rewards[id] = { xp, achievements: earned, daily: earnedDaily };
  }
  return rewards;
}
export async function getProgress(sql: SQL, id: string): Promise<Progression> {
  const day = new Date().toISOString().slice(0, 10);
  const xp =
    (
      await sql.query<{ xp: number }>(
        "SELECT xp FROM progression WHERE user_id=$1",
        [id],
      )
    ).rows[0]?.xp || 0;
  const achievements = (
    await sql.query<{ id: string; earned_at: string }>(
      "SELECT id,earned_at FROM achievements WHERE user_id=$1 ORDER BY earned_at",
      [id],
    )
  ).rows;
  const daily = (
    await sql.query<{ goal: string }>(
      "SELECT goal FROM daily_rewards WHERE user_id=$1 AND day=$2",
      [id, day],
    )
  ).rows;
  const count = (
    await sql.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM reward_events WHERE user_id=$1 AND day=$2",
      [id, day],
    )
  ).rows[0].count;
  return {
    xp,
    level: Math.floor(xp / 500) + 1,
    levelXp: xp % 500,
    nextLevelXp: 500,
    title:
      ACHIEVEMENTS.find((a) => a.id === achievements.at(-1)?.id)?.title ||
      "Rookie",
    achievements,
    daily: dailyGoals(day).map((g) => ({
      ...g,
      complete: daily.some((d) => d.goal === g.id),
    })),
    day,
    rewardedMatches: Math.min(5, count),
  };
}
