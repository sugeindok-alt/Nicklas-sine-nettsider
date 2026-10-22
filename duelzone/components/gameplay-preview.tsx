"use client";
import { useEffect, useRef } from "react";
import { Frontier, isFrontier } from "@/lib/frontier";
import { FrontierBot } from "@/lib/frontier-bot";
import { Competition, type CompetitionView } from "@/lib/competition";
import { BotDriver } from "@/lib/bot";
import { GAME_INFO, isCompetition, type Game, type Player } from "@/lib/shared";
import { renderFrontier } from "./frontier-field";

const players: Player[] = [
  {
    id: "preview-a",
    username: "AI / 01",
    accent: "#c8f36a",
    bio: "",
    bot: true,
  },
  {
    id: "preview-b",
    username: "AI / 02",
    accent: "#9cb9ee",
    bio: "",
    bot: true,
  },
];
const ink = ["#c8f36a", "#9cb9ee"];
function drawCompetition(ctx: CanvasRenderingContext2D, v: CompetitionView) {
  const circle = (
    x: number,
    y: number,
    r: number,
    color: string,
    fill = true,
  ) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    fill ? ctx.fill() : ctx.stroke();
  };
  const x = (n: number) => 230 + n * 540,
    y = (n: number) => 30 + n * 540;
  ctx.strokeStyle = "#ffffff0c";
  ctx.lineWidth = 1;
  for (let n = 0; n <= 10; n++) {
    ctx.beginPath();
    ctx.moveTo(x(n / 10), 30);
    ctx.lineTo(x(n / 10), 570);
    ctx.moveTo(230, y(n / 10));
    ctx.lineTo(770, y(n / 10));
    ctx.stroke();
  }
  if (v.discipline === "dodge") {
    v.hazards.forEach((h) =>
      circle(x(h.x), y(h.y), h.radius * 540, "#e8b39a", v.now >= h.activeAt),
    );
    Object.entries(v.players).forEach(([id, p], i) => {
      circle(x(p.x), y(p.y), 12, ink[i]);
      if (p.shieldUntil > v.now) circle(x(p.x), y(p.y), 22, ink[i], false);
      ctx.fillStyle = ink[i];
      ctx.font = "15px Manrope, sans-serif";
      ctx.fillText(
        id === players[0].id ? "AI / 01" : "AI / 02",
        x(p.x) - 24,
        y(p.y) - 26,
      );
    });
  } else if (v.discipline === "clash") {
    v.targets.forEach((t) => {
      const color =
        t.kind === "power"
          ? "#dec681"
          : t.kind === "decoy"
            ? "#e8b39a"
            : ink[0];
      circle(x(t.x), y(t.y), t.radius * 540, color, false);
      circle(x(t.x), y(t.y), 7, color);
      if (t.kind === "decoy") {
        ctx.beginPath();
        ctx.moveTo(x(t.x) - 8, y(t.y) - 8);
        ctx.lineTo(x(t.x) + 8, y(t.y) + 8);
        ctx.stroke();
      }
    });
  } else if (v.discipline === "grid") {
    v.tiles.forEach((owner, i) => {
      ctx.fillStyle =
        owner === players[0].id ? ink[0] : owner ? ink[1] : "#24272b";
      ctx.fillRect(230 + (i % 7) * 77, 30 + Math.floor(i / 7) * 77, 69, 69);
      if (i === v.bonusTile) {
        ctx.strokeStyle = "#e0c78d";
        ctx.lineWidth = 3;
        ctx.strokeRect(235 + (i % 7) * 77, 35 + Math.floor(i / 7) * 77, 59, 59);
      }
    });
  } else {
    const puzzle = v.puzzle;
    if (puzzle?.kind === "memory") {
      for (let i = 0; i < 9; i++) {
        const active =
          puzzle.sequence[Math.floor(v.now / 500) % puzzle.sequence.length] ===
            i && v.now < puzzle.revealUntil;
        ctx.fillStyle = active ? ink[0] : "#272b30";
        ctx.fillRect(
          310 + (i % 3) * 130,
          110 + Math.floor(i / 3) * 130,
          116,
          116,
        );
      }
    } else {
      ctx.fillStyle = "#eff0ed";
      ctx.font = "600 32px Manrope, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(puzzle?.prompt || "Read the pattern", 500, 235);
      puzzle?.choices.forEach((choice, i) => {
        ctx.fillStyle = "#26292d";
        ctx.fillRect(180 + i * 165, 320, 148, 100);
        ctx.fillStyle = "#eff0ed";
        ctx.fillText(choice, 254 + i * 165, 380);
      });
      ctx.textAlign = "left";
    }
  }
}
function drawClassic(ctx: CanvasRenderingContext2D, game: Game, time: number) {
  ctx.textAlign = "center";
  ctx.fillStyle = "#a0a4ac";
  ctx.font = "18px Manrope, sans-serif";
  if (game === "reaction") {
    const go = time % 4000 > 2100;
    if (go) {
      ctx.fillStyle = "#c8f36a";
      ctx.fillRect(140, 90, 720, 420);
    }
    ctx.fillStyle = go ? "#11150c" : "#f0f1ed";
    ctx.font = "800 74px Manrope, sans-serif";
    ctx.fillText(go ? "NOW." : "Wait for green.", 500, 310);
    ctx.font = "18px Manrope, sans-serif";
    ctx.fillText("SPACE OR TAP", 500, 375);
  } else if (game === "precision") {
    ctx.fillText("Stop in the centre", 500, 180);
    ctx.fillStyle = "#272b30";
    ctx.fillRect(130, 270, 740, 70);
    ctx.fillStyle = "#c8f36a33";
    ctx.fillRect(455, 270, 90, 70);
    ctx.fillStyle = ink[0];
    ctx.fillRect(497, 270, 6, 70);
    ctx.fillStyle = "#f0f1ed";
    ctx.fillRect(145 + (Math.sin(time / 600) + 1) * 350, 252, 5, 106);
    ctx.fillStyle = "#a0a4ac";
    ctx.fillText("SPACE TO LOCK", 500, 425);
  } else if (game === "speed") {
    ctx.fillText("Select the ink colour", 500, 150);
    ctx.fillStyle = "#a5bce9";
    ctx.font = "800 88px Manrope, sans-serif";
    ctx.fillText("CORAL", 500, 300);
    ["BLUE", "CORAL", "GREEN", "PURPLE"].forEach((s, i) => {
      ctx.fillStyle = "#26292d";
      ctx.fillRect(150 + i * 180, 375, 160, 70);
      ctx.fillStyle = "#dde0e4";
      ctx.font = "17px Manrope, sans-serif";
      ctx.fillText(s, 230 + i * 180, 419);
    });
  } else {
    const x = 500 + Math.sin(time / 1000) * 210,
      y = 300 + Math.cos(time / 1200) * 120;
    ctx.strokeStyle = "#ffffff0b";
    ctx.lineWidth = 1;
    for (let n = 0; n < 1000; n += 60) {
      ctx.beginPath();
      ctx.moveTo(n, 0);
      ctx.lineTo(n, 600);
      ctx.stroke();
    }
    [50, 34, 9].forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = ink[0];
      ctx.lineWidth = i === 2 ? 15 : 3;
      ctx.stroke();
    });
    ctx.fillText("Acquire the target", 500, 535);
  }
  ctx.textAlign = "left";
}
export function GameplayPreview({
  game,
  animate = false,
}: {
  game: Game;
  animate?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const enabled = useRef(animate),
    wake = useRef(() => {});
  enabled.current = animate;
  useEffect(() => {
    wake.current();
  }, [animate]);
  useEffect(() => {
    const canvas = ref.current!,
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false,
      frame = 0,
      previous = 0,
      time = 10000;
    let engine: Frontier | Competition | null = null;
    let bots: (FrontierBot | BotDriver)[] = [];
    const reset = () => {
      time = 10000;
      engine = isFrontier(game)
        ? new Frontier(
            game,
            players.map((p) => p.id),
            time,
          )
        : isCompetition(game)
          ? new Competition(
              game,
              players.map((p) => p.id),
              time,
            )
          : null;
      bots = players.map((p) =>
        isFrontier(game)
          ? new FrontierBot(p.id, p.id === "preview-a" ? "expert" : "medium")
          : new BotDriver(p.id, "hard"),
      );
    };
    const step = () => {
      time += 1000 / 30;
      if (engine instanceof Frontier) {
        for (const b of bots as FrontierBot[]) {
          const a = b.think(engine.snapshot(b.id), time);
          if (a) engine.action(b.id, a, time);
        }
        engine.tick(time);
      } else if (engine instanceof Competition) {
        for (const b of bots as BotDriver[]) {
          const a = b.think(engine.snapshot(), time);
          if (a) engine.action(b.id, a, time);
        }
        engine.tick(time);
      }
    };
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#101316";
      ctx.fillRect(0, 0, 1000, 600);
      if (engine instanceof Frontier) {
        const v = engine.snapshot(players[0].id);
        renderFrontier(
          ctx,
          v,
          players,
          players[0].id,
          v.game === "grapple"
            ? Math.max(0, v.players[players[0].id].x - 300)
            : 0,
          time,
          { id: 0, born: time },
        );
      } else if (engine instanceof Competition)
        drawCompetition(ctx, engine.snapshot());
      else drawClassic(ctx, game, time);
    };
    const loop = (timestamp: number) => {
      frame = 0;
      if (!visible || document.hidden || !enabled.current || reduced.matches)
        return;
      if (timestamp - previous >= 1000 / 30) {
        previous = timestamp;
        if (
          !canvas.closest("[inert]") &&
          document.body.style.overflow !== "hidden"
        ) {
          step();
          draw();
        }
        if (engine?.view.ended || time > 85000) reset();
      }
      frame = requestAnimationFrame(loop);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    };
    wake.current = resume;
    reset();
    for (let i = 0; i < (game === "grid" ? 260 : 65); i++) step();
    draw();
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);
    return () => {
      wake.current = () => {};
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    };
  }, [game]);
  return (
    <canvas
      ref={ref}
      width={1000}
      height={600}
      className="gameplay-preview-canvas"
      role="img"
      aria-label={`${GAME_INFO[game].name} gameplay preview${isFrontier(game) || isCompetition(game) ? " with AI players" : ""}`}
    />
  );
}
