import type { CompetitionView } from "./competition";
export const games = [
  "reaction",
  "aim",
  "speed",
  "precision",
  "dodge",
  "grid",
  "clash",
  "mind",
  "arena",
] as const;
export const featuredGames = [
  "dodge",
  "grid",
  "clash",
  "mind",
  "arena",
] as const;
export const isCompetition = (game: string) =>
  (featuredGames as readonly string[]).includes(game);
export type Game = (typeof games)[number];
export type Mode = "ranked" | "casual" | "friend" | "tournament";
export const GAME_INFO = {
  dodge: {
    name: "Dodge Duel",
    short: "Dodge",
    tag: "OUTLAST YOUR RIVAL",
    description:
      "Move through a shared arena. Read incoming hazards, dash through danger and protect your three lives. Last player standing wins; survival points break a timed tie.",
    rounds: 1,
    color: "#c8f36a",
    keys: "WASD / DRAG · SPACE TO DASH",
  },
  grid: {
    name: "Grid Rush",
    short: "Grid",
    tag: "TAKE CONTROL",
    description:
      "Capture tiles beside your territory. Cut into rival ground, hold the rotating bonus tile and spend three energy to fortify your newest tile. Most territory and bonus points wins.",
    rounds: 1,
    color: "#a5bce9",
    keys: "TAP ADJACENT TILES · SPACE TO FORTIFY",
  },
  clash: {
    name: "Aim Clash",
    short: "Clash",
    tag: "BUILD YOUR COMBO",
    description:
      "Race for shared moving targets. Chain hits for multipliers, claim gold power targets for double points and avoid crossed-out decoys. Three energy activates focus: larger hit zones for three seconds.",
    rounds: 1,
    color: "#e8b39a",
    keys: "POINT & CLICK · SPACE FOR FOCUS",
  },
  mind: {
    name: "Mind Battle",
    short: "Mind",
    tag: "STAY ONE STEP AHEAD",
    description:
      "Remember growing sequences, complete number patterns and solve logic puzzles. Both players face the same challenge; accurate streaks and fast solutions win.",
    rounds: 6,
    color: "#c2b4df",
    keys: "TAP TILES · 1–4 FOR ANSWERS",
  },
  arena: {
    name: "Speed Arena",
    short: "Arena",
    tag: "ADAPT. THEN ATTACK.",
    description:
      "Six rapid stages switch between survival, territory, moving targets and mind challenges. Each stage awards up to 1,000 points. Adapt quickly and win the combined score.",
    rounds: 6,
    color: "#d7dce4",
    keys: "ADAPT TO EACH STAGE",
  },
  reaction: {
    name: "Reaction Duel",
    short: "Reaction",
    tag: "TRUST YOUR INSTINCT",
    description:
      "One signal. A split-second decision. Wait for the green light, then strike.",
    rounds: 5,
    color: "#c8f36a",
    keys: "SPACE / TAP",
  },
  aim: {
    name: "Aim Duel",
    short: "Aim",
    tag: "FIND YOUR FOCUS",
    description:
      "Track the target. Find the center. Make every shot count before time runs out.",
    rounds: 8,
    color: "#a5bce9",
    keys: "POINT & CLICK",
  },
  speed: {
    name: "Speed Duel",
    short: "Speed",
    tag: "THINK FASTER",
    description:
      "Read the ink, not the word. Choose the right color under pressure.",
    rounds: 8,
    color: "#e8b39a",
    keys: "1 / 2 / 3 / 4",
  },
  precision: {
    name: "Precision Duel",
    short: "Precision",
    tag: "OWN THE MOMENT",
    description: "Stop the moving marker dead center. Timing is everything.",
    rounds: 6,
    color: "#c2b4df",
    keys: "SPACE / TAP",
  },
} as const;
export const RANKS = [
  { name: "Bronze", min: 0 },
  { name: "Silver", min: 1050 },
  { name: "Gold", min: 1200 },
  { name: "Platinum", min: 1400 },
  { name: "Diamond", min: 1650 },
  { name: "Master", min: 1900 },
  { name: "Champion", min: 2200 },
];
export function rankFor(rating: number) {
  return [...RANKS].reverse().find((r) => rating >= r.min)!;
}
export type Player = {
  id: string;
  username: string;
  accent: string;
  bio: string;
  rating?: number;
};
export type Challenge = {
  id: string;
  x?: number;
  y?: number;
  word?: string;
  ink?: string;
  choices?: string[];
  period?: number;
};
export type MatchState = {
  id: string;
  game: Game;
  mode: Mode;
  phase: "intro" | "waiting" | "active" | "review" | "finished";
  players: Player[];
  scores: Record<string, number>;
  answered: string[];
  round: number;
  rounds: number;
  serverNow: number;
  startedAt: number;
  deadline: number;
  challenge: Challenge | null;
  feedback: Record<string, { points: number; detail: string }>;
  winner: string | null;
  reason?: string;
  changes?: Record<string, number>;
  rematch: string[];
  competition?: CompetitionView;
  rewards?: Record<
    string,
    { xp: number; achievements: string[]; daily: string[] }
  >;
};
export function elo(a: number, b: number, result: number) {
  return Math.round(32 * (result - 1 / (1 + 10 ** ((b - a) / 400))));
}
export function markerPosition(elapsed: number, period = 1600) {
  return (1 - Math.cos((elapsed / period) * Math.PI * 2)) / 2;
}
export function seasonAt(date = new Date()) {
  const year = date.getUTCFullYear(),
    quarter = Math.floor(date.getUTCMonth() / 3);
  return {
    id: `${year}-Q${quarter + 1}`,
    name: `Season ${String(quarter + 1).padStart(2, "0")} / ${year}`,
    start: new Date(Date.UTC(year, quarter * 3, 1)).toISOString(),
    end: new Date(Date.UTC(year, (quarter + 1) * 3, 1)).toISOString(),
  };
}
