import type { FrontierView, Fighter } from "./frontier";
import type { Game, Player } from "./shared";
export const replayGames: readonly Game[] = [
  "knockout",
  "ball",
  "grapple",
  "core",
];
export type Replay = {
  version: 1;
  matchId: string;
  game: Game;
  players: Player[];
  duration: number;
  frames: { at: number; view: FrontierView }[];
  highlights: { at: number; label: string }[];
};
export function replayFrame(replay: Replay, at: number): FrontierView {
  const frames = replay.frames;
  let low = 0,
    high = frames.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (frames[mid].at <= at) low = mid;
    else high = mid - 1;
  }
  const a = frames[low],
    b = frames[Math.min(low + 1, frames.length - 1)],
    view = structuredClone(a.view);
  const mix = Math.max(0, Math.min(1, (at - a.at) / Math.max(1, b.at - a.at)));
  for (const [id, p] of Object.entries(view.players)) {
    const next = b.view.players[id];
    if (
      next &&
      p.teleports === next.teleports &&
      Math.hypot(p.x - next.x, p.y - next.y) < 350
    ) {
      p.x += (next.x - p.x) * mix;
      p.y += (next.y - p.y) * mix;
      p.vx += (next.vx - p.vx) * mix;
      p.vy += (next.vy - p.vy) * mix;
    }
  }
  view.ball.x += (b.view.ball.x - view.ball.x) * mix;
  view.ball.y += (b.view.ball.y - view.ball.y) * mix;
  view.now = a.view.now + (b.view.now - a.view.now) * mix;
  return view;
}
export function ghostFighter(
  source: Fighter,
  id: string,
  now: number,
  recordedNow = now,
): Fighter {
  return {
    ...structuredClone(source),
    id,
    lastInput: now,
    dashUntil: source.dashUntil + now - recordedNow,
    dashReady: source.dashReady + now - recordedNow,
    attackReady: source.attackReady + now - recordedNow,
    invulnerable: source.invulnerable + now - recordedNow,
    revealed: source.revealed + now - recordedNow,
    input: {
      dx: 0,
      dy: 0,
      aimX: 1,
      aimY: 0,
      primary: false,
      secondary: false,
      ability: false,
      jump: false,
      seq: 0,
    },
  };
}
