import type { Player } from "./shared";
import type { Sport } from "./frontier";
export const draftGames: Sport[] = [
  "knockout",
  "ball",
  "grapple",
  "shadow",
  "core",
];
export type DraftChoice = {
  ban: Sport | null;
  preferred: Sport | null;
  ready: boolean;
};
export type DraftState = {
  id: string;
  players: Player[];
  phase: "choices" | "confirm" | "starting";
  deadline: number;
  serverNow: number;
  choices: Record<string, DraftChoice>;
  selection: Sport[];
};
export function selectDraft(
  choices: DraftChoice[],
  priority: Sport[],
): Sport[] {
  const remaining = priority.filter(
    (game) => !choices.some((c) => c.ban === game),
  );
  return remaining
    .sort(
      (a, b) =>
        choices.filter((c) => c.preferred === b).length -
        choices.filter((c) => c.preferred === a).length,
    )
    .slice(0, 3);
}
