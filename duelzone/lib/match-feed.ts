import type { MatchState } from "./shared";
export type MatchFrame = Pick<
  MatchState,
  "id" | "serverNow" | "scores" | "competition" | "deadline" | "round"
>;
let current: MatchState | null = null;
const listeners = new Set<() => void>();
export const network = { rtt: 0 };
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
    current = { ...current, ...frame };
    listeners.forEach((f) => f());
  },
};
