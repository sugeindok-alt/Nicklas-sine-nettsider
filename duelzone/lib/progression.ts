import { featuredGames, GAME_INFO, type Game } from "./shared";
export const ACHIEVEMENTS = [
  {
    id: "first-win",
    name: "First blood",
    description: "Win a completed duel.",
    title: "Challenger",
  },
  {
    id: "versatile",
    name: "No weak side",
    description: "Complete all five new disciplines.",
    title: "All-rounder",
  },
  {
    id: "untouched",
    name: "Untouchable",
    description: "Finish Dodge Duel with all three lives.",
    title: "Ghost",
  },
  {
    id: "combo",
    name: "Locked in",
    description: "Finish Aim Clash with an eight-hit streak.",
    title: "Sharpshooter",
  },
  {
    id: "territory",
    name: "Ground control",
    description: "Hold at least 20 tiles when Grid Rush ends.",
    title: "Tactician",
  },
  {
    id: "memory",
    name: "Clear mind",
    description: "Solve all six Mind Battle puzzles without a mistake.",
    title: "Mastermind",
  },
  {
    id: "arena-win",
    name: "Adapt & overcome",
    description: "Win a full Speed Arena match.",
    title: "Versatile",
  },
  {
    id: "ten-wins",
    name: "A statement",
    description: "Win ten completed ranked matches.",
    title: "Contender",
  },
] as const;
export function dailyGame(day = new Date().toISOString().slice(0, 10)): Game {
  return featuredGames[
    Math.floor(Date.parse(day + "T00:00:00Z") / 86400000) % featuredGames.length
  ];
}
export function dailyGoals(day?: string) {
  const game = dailyGame(day);
  return [
    {
      id: "play",
      name: "Step into the arena",
      description: "Finish one duel.",
    },
    {
      id: "featured",
      name: "Today's discipline",
      description: `Finish ${GAME_INFO[game].name}.`,
    },
    { id: "win", name: "Make it count", description: "Win a completed duel." },
  ];
}
export type Progression = {
  xp: number;
  level: number;
  levelXp: number;
  nextLevelXp: number;
  title: string;
  achievements: { id: string; earned_at: string }[];
  daily: { id: string; name: string; description: string; complete: boolean }[];
  day: string;
  rewardedMatches: number;
};
