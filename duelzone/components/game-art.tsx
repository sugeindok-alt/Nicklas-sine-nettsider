import {
  Crosshair,
  Zap,
  Gauge,
  ScanLine,
  Move,
  Grid3X3,
  Brain,
  Swords,
} from "lucide-react";
import type { Game } from "@/lib/shared";
export const gameIcons = {
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
    <div
      className={`game-art art-${game === "grid" ? "gridrush" : game} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <div className="art-grid" />
      {game === "dodge" && (
        <div className="dodge-art">
          <span className="runner-mark" />
          <span className="rival-mark" />
          {Array.from({ length: 6 }, (_, i) => (
            <i key={i} style={{ "--obstacle": i } as React.CSSProperties} />
          ))}
          <b>READ THE APPROACH</b>
        </div>
      )}
      {game === "grid" && (
        <div className="grid-art">
          {Array.from({ length: 25 }, (_, i) => (
            <i
              key={i}
              className={
                i < 9 ? "side-one" : i > 17 ? "side-two" : i === 12 ? "hot" : ""
              }
            />
          ))}
        </div>
      )}
      {game === "clash" && (
        <div className="clash-art">
          <span />
          <span />
          <span />
          <b>COMBO ×4</b>
        </div>
      )}
      {game === "mind" && (
        <div className="mind-art">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ "--memory-index": i } as React.CSSProperties} />
          ))}
          <b>RECALL / REPEAT</b>
        </div>
      )}
      {game === "arena" && (
        <div className="arena-art">
          <Move />
          <Grid3X3 />
          <Crosshair />
          <Brain />
          <b>ADAPT TO ANYTHING</b>
        </div>
      )}
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
