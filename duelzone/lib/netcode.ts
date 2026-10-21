import type { CompetitionView, Runner } from "./competition";

export const INPUT_INTERVAL = 50;
export const INPUT_HEARTBEAT = 160;
export const INPUT_TIMEOUT = 500;
export const clampPosition = (n: number) => Math.max(0.025, Math.min(0.975, n));
export function moveRunner(
  p: Pick<Runner, "x" | "y" | "dx" | "dy" | "dashUntil" | "hp">,
  from: number,
  to: number,
) {
  if (!p.hp || to <= from) return { x: p.x, y: p.y };
  const end = Math.min(to, from + 250);
  const dash = Math.max(0, Math.min(end, p.dashUntil) - from);
  const distance =
    (dash * 1.1 + (end - from - dash) * 0.45) /
    1000 /
    Math.max(1, Math.hypot(p.dx, p.dy));
  return {
    x: clampPosition(p.x + p.dx * distance),
    y: clampPosition(p.y + p.dy * distance),
  };
}

type Input = { seq: number; at: number; dx: number; dy: number };
export class MovementTimeline {
  private frames: CompetitionView[] = [];
  private pending: Input[] = [];
  private stage = "";
  private displayed?: { x: number; y: number };
  private renderedAt = 0;
  private receivedAt = 0;
  private offset = 0;
  private delay = 130;
  private direction = { dx: 0, dy: 0 };
  constructor(private userId: string) {}
  receive(view: CompetitionView, local: number, oneWay = 0) {
    const key = `${view.stage}:${view.startedAt}`;
    if (key !== this.stage) {
      this.frames = [];
      this.pending = [];
      this.displayed = undefined;
      this.direction = { dx: 0, dy: 0 };
      this.stage = key;
    }
    const previous = this.frames.at(-1);
    if (previous && view.now <= previous.now) return;
    if (previous)
      this.delay = Math.max(
        110,
        Math.min(200, this.delay * 0.9 + (local - this.receivedAt + 25) * 0.1),
      );
    this.receivedAt = local;
    const measured = view.now + Math.min(150, Math.max(0, oneWay)) - local;
    this.offset = previous ? this.offset * 0.8 + measured * 0.2 : measured;
    this.frames.push(view);
    this.frames = this.frames.slice(-12);
    const ack = view.players[this.userId]?.inputSequence || 0;
    this.pending = this.pending.filter((i) => i.seq > ack).slice(-60);
  }
  input(seq: number, dx: number, dy: number, local: number) {
    this.direction = { dx, dy };
    this.pending.push({ seq, dx, dy, at: local + this.offset });
    this.pending = this.pending.slice(-60);
  }
  time(local: number) {
    return local + this.offset;
  }
  sample(local: number) {
    const latest = this.frames.at(-1);
    if (!latest) return null;
    const now = Math.min(this.time(local), latest.now + 250);
    const targetTime = now - this.delay;
    const before =
      [...this.frames].reverse().find((v) => v.now <= targetTime) ||
      this.frames[0];
    const after = this.frames.find((v) => v.now >= targetTime) || latest;
    const t =
      before.now === after.now
        ? 1
        : Math.max(
            0,
            Math.min(1, (targetTime - before.now) / (after.now - before.now)),
          );
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of Object.entries(latest.players)) {
      if (id !== this.userId) {
        const a = before.players[id] || p,
          b = after.players[id] || p;
        positions[id] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        continue;
      }
      let predicted = { ...p },
        at = latest.now;
      for (const input of this.pending) {
        const changeAt = Math.max(at, Math.min(now, input.at));
        Object.assign(predicted, moveRunner(predicted, at, changeAt), {
          dx: input.dx,
          dy: input.dy,
        });
        at = changeAt;
      }
      if (now - p.lastInput > INPUT_TIMEOUT && !this.pending.length)
        predicted.dx = predicted.dy = 0;
      const target = moveRunner(predicted, at, now);
      const dt = Math.max(0, Math.min(50, local - this.renderedAt));
      if (
        !this.displayed ||
        latest.ended ||
        !p.hp ||
        latest.transitionUntil > now
      )
        this.displayed = target;
      else {
        const moving =
          local - this.receivedAt < 300 ? this.direction : { dx: 0, dy: 0 };
        const next = moveRunner(
          { ...p, ...this.displayed, ...moving },
          now - dt,
          now,
        );
        const error = Math.hypot(target.x - next.x, target.y - next.y);
        const blend = error > 0.25 ? 1 : 1 - Math.exp(-dt / 90);
        this.displayed = {
          x: next.x + (target.x - next.x) * blend,
          y: next.y + (target.y - next.y) * blend,
        };
      }
      positions[id] = this.displayed;
    }
    this.renderedAt = local;
    return { now, positions, age: Math.max(0, local - this.receivedAt) };
  }
}
