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
import { isFrontier, FRONTIER_INFO } from "@/lib/frontier";
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
    <div
      className={`game-art art-${game === "grid" ? "gridrush" : game} ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <div className="art-grid" />
      {isFrontier(game) && (
        <div className="frontier-art">
          <svg viewBox="0 0 320 200" fill="none" aria-hidden="true">
            {game === "knockout" && (
              <>
                <ellipse
                  cx="160"
                  cy="105"
                  rx="85"
                  ry="56"
                  fill="#253029"
                  stroke="currentColor"
                />
                <ellipse
                  cx="160"
                  cy="105"
                  rx="65"
                  ry="41"
                  stroke="currentColor"
                  opacity=".3"
                  strokeDasharray="4 7"
                />
                <path
                  d="M130 95L178 117"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <circle
                  className="art-runner"
                  cx="130"
                  cy="95"
                  r="10"
                  fill="currentColor"
                />
                <circle cx="188" cy="122" r="10" fill="#a5bce9" />
              </>
            )}
            {game === "ball" && (
              <>
                <rect
                  x="52"
                  y="40"
                  width="216"
                  height="118"
                  stroke="currentColor"
                  opacity=".5"
                />
                <path
                  d="M160 40V158M52 77H76V122H52M268 77H244V122H268"
                  stroke="currentColor"
                />
                <circle
                  cx="160"
                  cy="99"
                  r="28"
                  stroke="currentColor"
                  opacity=".5"
                />
                <circle
                  className="art-runner"
                  cx="125"
                  cy="110"
                  r="9"
                  fill="currentColor"
                />
                <path d="M147 97L197 78" stroke="#dde3e9" strokeWidth="2" />
                <circle cx="197" cy="78" r="7" fill="#dde3e9" />
              </>
            )}
            {game === "grapple" && (
              <>
                <path
                  d="M45 145H100V170M180 125H236V170M130 20V53M130 53L180 105"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <circle cx="130" cy="53" r="7" stroke="currentColor" />
                <circle
                  className="art-runner"
                  cx="180"
                  cy="105"
                  r="10"
                  fill="currentColor"
                />
                <path
                  d="M110 140Q193 154 224 70"
                  stroke="currentColor"
                  strokeDasharray="3 5"
                  opacity=".5"
                />
              </>
            )}
            {game === "shadow" && (
              <>
                <path
                  d="M68 45H95V120H68ZM150 90H173V157H150ZM222 40H245V108H222Z"
                  fill="#333b47"
                  stroke="#56616c"
                />
                <path
                  d="M115 133L155 30L250 110Z"
                  fill="currentColor"
                  opacity=".09"
                />
                <circle cx="115" cy="133" r="10" fill="currentColor" />
                <rect
                  x="193"
                  y="54"
                  width="15"
                  height="15"
                  stroke="currentColor"
                />
                <circle
                  cx="211"
                  cy="148"
                  r="9"
                  stroke="#a5bce9"
                  strokeDasharray="3 3"
                />
              </>
            )}
            {game === "core" && (
              <>
                <circle
                  cx="160"
                  cy="100"
                  r="54"
                  fill="currentColor"
                  opacity=".08"
                />
                <circle
                  className="art-orbit"
                  cx="160"
                  cy="100"
                  r="54"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="70 15"
                />
                <path
                  d="M160 75V125M135 100H185M60 55H101M219 145H260"
                  stroke="currentColor"
                />
                <circle
                  className="art-runner"
                  cx="130"
                  cy="92"
                  r="9"
                  fill="#c8f36a"
                />
                <circle cx="213" cy="115" r="9" fill="#a5bce9" />
              </>
            )}
            {game === "showdown" && (
              <>
                <path
                  d="M94 50L160 25L226 50V100L160 152L94 100Z"
                  stroke="currentColor"
                  fill="#d8caa710"
                />
                <text
                  x="160"
                  y="104"
                  textAnchor="middle"
                  fill="currentColor"
                  fontSize="55"
                  fontFamily="sans-serif"
                  fontWeight="500"
                >
                  V
                </text>
                <path
                  d="M117 168H129M139 168H151M161 168H173M183 168H195M205 168H217"
                  stroke="currentColor"
                  strokeWidth="3"
                />
              </>
            )}
          </svg>
          <span className="art-title">{FRONTIER_INFO[game].tag}</span>
        </div>
      )}
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
