export const games = ["reaction", "aim", "speed", "precision"] as const;
export type Game = (typeof games)[number];
export type Mode = "ranked" | "casual" | "friend" | "tournament";
export const GAME_INFO = {
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
