import type { MatchState } from "./shared";
export type MatchFrame = Pick<
  MatchState,
  "id" | "serverNow" | "scores" | "competition" | "deadline" | "round"
> & { frontier?: Partial<import("./frontier").FrontierView> };
let current: MatchState | null = null;
const listeners = new Set<() => void>();
export const network = { rtt: 0, samples: [] as number[], total: 0, failed: 0 };
export function recordProbe(rtt: number | null) {
  network.total++;
  if (rtt === null) {
    network.failed++;
    return;
  }
  network.rtt = rtt;
  network.samples.push(rtt);
  if (network.samples.length > 20) network.samples.shift();
}
export const matchFeed = {
  get: () => current,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  publish: (state: MatchState) => {
    current = state;
    listeners.forEach((f) => f());
  },
  frame: (frame: MatchFrame) => {
    if (
      !current ||
      current.id !== frame.id ||
      current.phase !== "active" ||
      frame.serverNow <= current.serverNow
    )
      return;
    current = {
      ...current,
      ...frame,
      frontier:
        frame.frontier && current.frontier
          ? { ...current.frontier, ...frame.frontier }
          : current.frontier,
    };
    listeners.forEach((f) => f());
  },
};
