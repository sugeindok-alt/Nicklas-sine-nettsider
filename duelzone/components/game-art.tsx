import { GameplayPreview } from "./gameplay-preview";
import {
  Crosshair,
  Zap,
  Gauge,
  ScanLine,
  Move,
  Grid3X3,
  Brain,
  Swords,
  Trophy,
} from "lucide-react";
import type { Game } from "@/lib/shared";
export const gameIcons = {
  knockout: Swords,
  ball: Gauge,
  grapple: Move,
  shadow: ScanLine,
  core: Crosshair,
  showdown: Trophy,
  reaction: Zap,
  aim: Crosshair,
  speed: Gauge,
  precision: ScanLine,
  dodge: Move,
  grid: Grid3X3,
  clash: Crosshair,
  mind: Brain,
  arena: Swords,
};
export default function GameArt({
  game,
  large = false,
}: {
  game: Game;
  large?: boolean;
}) {
  return (
    <div className={`game-art art-${game} ${large ? "large-art" : ""}`}>
      <GameplayPreview game={game} />
    </div>
  );
}
