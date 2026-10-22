import type { Game, Player } from "./shared";

export type MatchRules = {
  length: "quick" | "standard" | "extended";
  spectators: boolean;
};
export const defaultRules: MatchRules = {
  length: "standard",
  spectators: false,
};
export const lengthScale = { quick: 2 / 3, standard: 1, extended: 1.5 };
export const watchableGames: readonly Game[] = ["dodge", "grid", "clash"];
export type Privacy = {
  requests: boolean;
  messages: boolean;
  challenges: boolean;
  presence: boolean;
  spectators: boolean;
};
export const defaultPrivacy: Privacy = {
  requests: true,
  messages: true,
  challenges: true,
  presence: true,
  spectators: false,
};
export type Presence = "online" | "offline" | "in-match" | "hidden";
export type Friend = Player & {
  presence: Presence;
  watchable: boolean;
  unread: number;
};
export type FriendRequest = Player & {
  from_id: string;
  to_id: string;
  created_at: string;
};
export type SocialChallenge = {
  id: string;
  from_id: string;
  to_id: string;
  sender: string;
  recipient: string;
  game: Game;
  rules: MatchRules;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  expires_at: string;
  created_at: string;
  match_id: string | null;
};
export type Message = {
  id: string;
  from_id: string;
  to_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};
export type SocialState = {
  friends: Friend[];
  requests: FriendRequest[];
  challenges: SocialChallenge[];
  blocked: Player[];
  settings: Privacy;
};
