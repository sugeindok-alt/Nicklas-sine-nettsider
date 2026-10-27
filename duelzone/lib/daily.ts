export const DAILY_VERSION = 1;
export const DAILY_DURATION = 30000;
export type DailyConfig = {
  version: number;
  day: string;
  seed: number;
  duration: number;
  interval: number;
  radius: number;
};
export type DailyRun = {
  id: string;
  config: DailyConfig;
  startedAt: number;
  serverNow: number;
  status: "active" | "finished" | "cancelled";
  score: number;
  hits: number;
  shots: number;
  attempted: number[];
  last?: { index: number; points: number };
  saved?: boolean;
};
export type DailyEntry = {
  username: string;
  user_id: string;
  score: number;
  hits: number;
  shots: number;
  day: string;
  finished_at: string;
};
export type DailyOverview = {
  config: DailyConfig;
  resetAt: string;
  board: DailyEntry[];
  history: DailyEntry[];
  personal: DailyEntry | null;
  attempts: number;
};
export function dailyConfig(
  day = new Date().toISOString().slice(0, 10),
): DailyConfig {
  let seed = 2166136261;
  for (const c of `duelzone-focus-v${DAILY_VERSION}:${day}`)
    seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  return {
    version: DAILY_VERSION,
    day,
    seed,
    duration: DAILY_DURATION,
    interval: 1000,
    radius: 43,
  };
}
export function dailyTarget(
  config: DailyConfig,
  index: number,
  elapsed: number,
) {
  let seed = (config.seed + Math.imul(index + 1, 2654435761)) >>> 0;
  const random = () => {
    seed = Math.imul(seed ^ (seed >>> 16), 2246822507) >>> 0;
    return seed / 4294967296;
  };
  const x = 130 + random() * 740,
    y = 110 + random() * 380;
  const phase = random() * Math.PI * 2;
  const age = elapsed - index * config.interval;
  return {
    x: x + Math.sin(age / 420 + phase) * 38,
    y: y + Math.cos(age / 500 + phase) * 28,
    age,
  };
}
export function dailyShot(
  config: DailyConfig,
  elapsed: number,
  index: number,
  x: number,
  y: number,
) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= config.duration / config.interval ||
    ![elapsed, x, y].every(Number.isFinite)
  )
    return null;
  const target = dailyTarget(config, index, elapsed);
  if (
    elapsed < 0 ||
    elapsed >= config.duration ||
    target.age < 80 ||
    target.age >= 920
  )
    return null;
  const distance = Math.hypot(x - target.x, y - target.y);
  return distance <= config.radius
    ? Math.round(40 + 60 * (1 - distance / config.radius))
    : 0;
}
