import {
  distance,
  visible,
  neutral,
  type Control,
  type FrontierView,
  type Vector,
} from "./frontier";
import type { Difficulty } from "./bot";
const levels = {
  easy: { delay: 550, speed: 0.65, error: 0.28 },
  medium: { delay: 300, speed: 0.85, error: 0.14 },
  hard: { delay: 180, speed: 1, error: 0.06 },
  expert: { delay: 110, speed: 1, error: 0.015 },
};
function route(from: Vector, to: Vector, v: FrontierView): Vector {
  const walls = v.walls.map((w) => ({
    x: w.x - 24,
    y: w.y - 24,
    w: w.w + 48,
    h: w.h + 48,
  }));
  if (visible(from, to, walls)) return to;
  const nodes = [
    from,
    to,
    ...v.walls.flatMap((w) => [
      { x: w.x - 30, y: w.y - 30 },
      { x: w.x + w.w + 30, y: w.y - 30 },
      { x: w.x - 30, y: w.y + w.h + 30 },
      { x: w.x + w.w + 30, y: w.y + w.h + 30 },
    ]),
  ];
  const cost = nodes.map(() => Infinity),
    parent = nodes.map(() => -1),
    done = new Set<number>();
  cost[0] = 0;
  for (let k = 0; k < nodes.length; k++) {
    let i = -1;
    for (let j = 0; j < nodes.length; j++)
      if (!done.has(j) && (i < 0 || cost[j] < cost[i])) i = j;
    if (i < 0 || !Number.isFinite(cost[i])) break;
    if (i === 1) {
      let p = 1;
      while (parent[p] > 0) p = parent[p];
      return nodes[p];
    }
    done.add(i);
    for (let j = 1; j < nodes.length; j++)
      if (!done.has(j) && visible(nodes[i], nodes[j], walls)) {
        const next = cost[i] + distance(nodes[i], nodes[j]);
        if (next < cost[j]) {
          cost[j] = next;
          parent[j] = i;
        }
      }
  }
  return from;
}
export class FrontierBot {
  private next = 0;
  private seq = 0;
  private last = neutral();
  constructor(
    readonly id: string,
    private difficulty: Difficulty,
  ) {}
  think(v: FrontierView, now: number): Control | null {
    if (now < this.next) return null;
    const level = levels[this.difficulty];
    this.next = now + Math.min(300, level.delay);
    const p = v.players[this.id],
      q = Object.values(v.players).find((x) => x.id !== this.id)!;
    if (!p || !q) return null;
    const c = neutral();
    c.seq = ++this.seq;
    let target: Vector = q,
      aim: Vector = q;
    if (v.game === "core")
      target = distance(p, v.objective) > 40 ? v.objective : q;
    if (v.game === "knockout") {
      const n = {
        x: (q.x - 500) / Math.max(1, distance(q, { x: 500, y: 300 })),
        y: (q.y - 300) / Math.max(1, distance(q, { x: 500, y: 300 })),
      };
      target =
        distance(p, { x: 500, y: 300 }) > v.ring - 35
          ? { x: 500, y: 300 }
          : { x: q.x - n.x * 45, y: q.y - n.y * 45 };
    }
    if (v.game === "ball") {
      const goal = {
        x: Object.keys(v.players).indexOf(this.id) ? 0 : 1000,
        y: 300,
      };
      const d = Math.max(1, distance(v.ball, goal));
      target = {
        x: v.ball.x - ((goal.x - v.ball.x) / d) * 45,
        y: v.ball.y - ((goal.y - v.ball.y) / d) * 45,
      };
      aim = goal;
      c.primary = distance(p, v.ball) < 95 && p.charge < 0.5;
    }
    if (v.game === "shadow") {
      if (v.hunter === this.id) {
        target = q.hidden
          ? [...v.relics, { x: 120, y: 300 }][
              Math.floor((now - v.startedAt) / 4200) % 4
            ]
          : q;
        aim = target;
        c.primary = !this.last.primary && now >= p.attackReady;
      } else {
        target = v.relics
          .filter((x) => !x.taken)
          .sort((a, b) => distance(p, a) - distance(p, b))[0] || {
          x: 120,
          y: 300,
        };
        if (distance(p, q) < 110)
          target = { x: p.x + (p.x - q.x) * 2, y: p.y + (p.y - q.y) * 2 };
        c.secondary = distance(p, q) < 240 && distance(p, q) > 150;
      }
    }
    if (v.game === "grapple") {
      c.dx = level.speed;
      c.aimX = 1;
      c.aimY = -0.7;
      c.jump = p.grounded && !this.last.jump;
      c.primary = p.hook
        ? p.x < p.hook.x + 35 && p.y > p.hook.y + 55
        : p.vy > 0 && !p.grounded && !this.last.primary;
      c.ability = p.vy > 350 && !this.last.ability && now >= p.dashReady;
    } else {
      target = route(p, target, v);
      const d = Math.max(25, distance(p, target));
      c.dx = ((target.x - p.x) / d) * level.speed;
      c.dy = ((target.y - p.y) / d) * level.speed;
      const angle =
        Math.atan2(aim.y - p.y, aim.x - p.x) +
        Math.sin(now / 700) * level.error;
      c.aimX = Math.cos(angle);
      c.aimY = Math.sin(angle);
      if (v.game === "core" || v.game === "knockout") {
        c.primary = distance(p, q) < 125 && p.charge < 0.4 + level.error;
        c.secondary =
          q.charge > 0.3 && distance(p, q) < 105 && this.difficulty !== "easy";
      }
      c.ability =
        !this.last.ability &&
        now >= p.dashReady &&
        ((v.game === "shadow" &&
          v.hunter !== this.id &&
          distance(p, q) < 130) ||
          (distance(p, target) > 170 && v.game !== "knockout"));
    }
    this.last = c;
    return c;
  }
}
