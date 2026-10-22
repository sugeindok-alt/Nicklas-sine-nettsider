import { games, type Game, type Player } from "./shared";
import type { MatchRules } from "./social";
export type Notification = {
  id: string;
  kind: string;
  body: string;
  target: string | null;
  created_at: string;
  read_at: string | null;
};
export type Preferences = { favorites: Game[]; excluded: Game[] };
export const defaultPreferences: Preferences = { favorites: [], excluded: [] };
export type Party = {
  id: string;
  host_id: string;
  game: Game | "any";
  rules: MatchRules;
  members: (Player & { ready: boolean; online: boolean })[];
};
export type PartyInvite = {
  id: string;
  party_id: string;
  sender: string;
  expires_at: string;
};
export type PlatformState = {
  notifications: Notification[];
  unread: number;
  preferences: Preferences;
  party: Party | null;
  invitations: PartyInvite[];
  tournamentInvitations: {
    id: string;
    tournament_id: string;
    name: string;
    game: Game;
    sender: string;
    expires_at: string;
  }[];
};
export const categories = [
  "All games",
  "Movement",
  "Combat",
  "Sport",
  "Tactics",
  "Focus",
  "Mixed",
] as const;
export const category: Record<Game, string> = {
  knockout: "Combat",
  ball: "Sport",
  grapple: "Movement",
  shadow: "Tactics",
  core: "Tactics",
  showdown: "Mixed",
  dodge: "Movement",
  grid: "Tactics",
  clash: "Focus",
  mind: "Focus",
  arena: "Mixed",
  reaction: "Focus",
  aim: "Focus",
  speed: "Focus",
  precision: "Focus",
};
export const duration = (g: Game) =>
  g === "showdown"
    ? "2–3 min"
    : g === "arena"
      ? "70 sec"
      : ["knockout", "ball", "grapple", "shadow", "core"].includes(g)
        ? "Up to 90 sec"
        : ["dodge", "grid", "clash"].includes(g)
          ? "45–60 sec"
          : "20–60 sec";
export const compatibleGames = (
  a: Game | "any",
  b: Game | "any",
  excludedA: Game[] = [],
  excludedB: Game[] = [],
) =>
  games.filter(
    (g) =>
      (a === "any" || a === g) &&
      (b === "any" || b === g) &&
      !excludedA.includes(g) &&
      !excludedB.includes(g),
  );
