import { featuredGames, GAME_INFO, type Game } from "./shared";
export const ACHIEVEMENTS = [
  {
    id: "first-ranked",
    name: "On the board",
    description: "Win your first completed ranked match.",
    title: "Ranked challenger",
  },
  {
    id: "game-ten",
    name: "Know your game",
    description: "Win ten completed matches in one discipline.",
    title: "Specialist",
  },
  {
    id: "personal-best",
    name: "Raise the bar",
    description: "Beat an existing multiplayer personal record.",
    title: "Pacesetter",
  },
  {
    id: "clean-sweep",
    name: "No reply",
    description: "Win a Showdown series without dropping a round.",
    title: "Series closer",
  },
  {
    id: "tournament-win",
    name: "Top of the bracket",
    description: "Win a four- or eight-player tournament.",
    title: "Tournament winner",
  },
  {
    id: "daily-focus",
    name: "Daily discipline",
    description: "Score at least 2,700 in a completed Daily Duel.",
    title: "Focus specialist",
  },
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
  weekly?: {
    id: string;
    name: string;
    description: string;
    progress: number;
    target: number;
    complete: boolean;
    xp: number;
  }[];
  week?: string;
};
export const rarity: Record<string, string> = {
  "first-win": "Common",
  versatile: "Rare",
  untouched: "Epic",
  combo: "Rare",
  territory: "Rare",
  memory: "Epic",
  "arena-win": "Rare",
  "ten-wins": "Epic",
};
export function weekAt(date = new Date()) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const WEEKLY_GOALS = [
  {
    id: "duels",
    name: "A good week",
    description: "Complete five scored duels.",
    target: 5,
    xp: 150,
  },
  {
    id: "wins",
    name: "Make your mark",
    description: "Win three scored duels.",
    target: 3,
    xp: 150,
  },
  {
    id: "variety",
    name: "Broaden your game",
    description: "Finish three different disciplines.",
    target: 3,
    xp: 150,
  },
] as const;
