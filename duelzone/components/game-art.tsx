import { Crosshair, Zap, Gauge, ScanLine } from "lucide-react";
import type { Game } from "@/lib/shared";
export const gameIcons = {
  reaction: Zap,
  aim: Crosshair,
  speed: Gauge,
  precision: ScanLine,
};
export default function GameArt({
  game,
  large = false,
}: {
  game: Game;
  large?: boolean;
}) {
  return (
    <div
      className={`game-art art-${game} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <div className="art-grid" />
      {game === "reaction" && (
        <>
          <div className="pulse-ring r1" />
          <div className="pulse-ring r2" />
          <div className="pulse-ring r3" />
          <div className="reaction-core">
            <Zap size={large ? 56 : 32} strokeWidth={1.5} />
          </div>
          <span className="art-mark top">STIMULUS / RESPONSE</span>
          <span className="art-mark bottom">READY WHEN YOU ARE</span>
        </>
      )}
      {game === "aim" && (
        <>
          <div className="aim-ring" />
          <div className="aim-lines" />
          <div className="aim-dot" />
          <i className="ghost-target" />
          <span className="art-mark top">ACQUIRE / LOCK / HIT</span>
          <span className="art-mark bottom">PRECISION UNDER PRESSURE</span>
        </>
      )}
      {game === "speed" && (
        <>
          <div className="speed-tracks">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <Gauge className="speed-icon" size={70} strokeWidth={1} />
          <span className="art-mark top">PROCESS / DECIDE</span>
          <span className="art-mark bottom">KEEP YOUR MIND AHEAD</span>
        </>
      )}
      {game === "precision" && (
        <>
          <div className="precision-art">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <div className="precision-zone" />
            <div className="precision-needle" />
          </div>
          <span className="art-mark top">CONTROL / CONSISTENCY</span>
          <span className="art-mark bottom">FIND THE PERFECT MOMENT</span>
        </>
      )}
    </div>
  );
}
