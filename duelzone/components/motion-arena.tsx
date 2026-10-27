"use client";
import {
  useEffect,
  useRef,
  type MutableRefObject,
  type PointerEvent,
} from "react";
import type { CompetitionView } from "@/lib/competition";
import type { MovementTimeline } from "@/lib/netcode";

export function MotionArena({
  view,
  userId,
  timeline,
  onDown,
  onMove,
  onUp,
}: {
  view: CompetitionView;
  userId: string;
  timeline: MutableRefObject<MovementTimeline>;
  onDown: (point: { x: number; y: number }) => void;
  onMove: (point: { x: number; y: number }) => void;
  onUp: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(view);
  latest.current = view;
  useEffect(() => {
    const element = canvas.current!,
      ctx = element.getContext("2d")!;
    let frame = 0,
      previousPoints = 0,
      feedbackUntil = 0;
    let width = 500;
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = element.height = Math.round(width * ratio);
    });
    resize.observe(element);
    const draw = () => {
      const v = latest.current,
        sample = timeline.current.sample(Date.now());
      if (!sample || !width) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const { now, positions } = sample;
      ctx.setTransform(element.width / 1000, 0, 0, element.height / 1000, 0, 0);
      ctx.clearRect(0, 0, 1000, 1000);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#ffffff08";
      ctx.beginPath();
      for (let i = 100; i < 1000; i += 100) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 1000);
        ctx.moveTo(0, i);
        ctx.lineTo(1000, i);
      }
      ctx.stroke();
      const circle = (
        x: number,
        y: number,
        r: number,
        fill: string,
        stroke?: string,
      ) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      };
      const dt = Math.max(0, Math.min(0.25, (now - v.now) / 1000));
      if (v.discipline === "dodge") {
        for (const h of v.hazards) {
          if (now < h.activeAt) {
            const x = Math.max(30, Math.min(970, h.x * 1000)),
              y = Math.max(30, Math.min(970, h.y * 1000));
            ctx.setLineDash([6, 6]);
            circle(x, y, 24, "", "#e8b39a");
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + h.vx * 150, y + h.vy * 150);
            ctx.stroke();
          } else
            circle(
              (h.x + h.vx * dt) * 1000,
              (h.y + h.vy * dt) * 1000,
              h.radius * 1000,
              "#e8b39a",
            );
        }
        for (const [id, p] of Object.entries(v.players)) {
          const pos = positions[id] || p,
            color = id === userId ? "#c8f36a" : "#a5bce9";
          ctx.globalAlpha = p.hp ? 1 : 0.2;
          if (p.shieldUntil > now) {
            ctx.setLineDash([8, 5]);
            circle(pos.x * 1000, pos.y * 1000, 38, "", color);
            ctx.setLineDash([]);
          }
          circle(pos.x * 1000, pos.y * 1000, 22, color);
          ctx.font = "22px sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = color;
          ctx.fillText(
            id === userId ? "YOU" : "RIVAL",
            pos.x * 1000,
            pos.y * 1000 - 48,
          );
          ctx.globalAlpha = 1;
        }
      } else {
        for (const t of v.targets) {
          const x = Math.max(0.07, Math.min(0.93, t.x + t.vx * dt)) * 1000,
            y = Math.max(0.07, Math.min(0.93, t.y + t.vy * dt)) * 1000;
          const color =
            t.kind === "power"
              ? "#dec681"
              : t.kind === "decoy"
                ? "#e8b39a"
                : "#c8f36a";
          const radius =
            t.radius * 1000 * (now < v.players[userId].focusUntil ? 1.5 : 1);
          circle(x, y, radius, "#ffffff06", color);
          if (t.kind === "decoy") {
            ctx.beginPath();
            ctx.moveTo(x - 16, y - 16);
            ctx.lineTo(x + 16, y + 16);
            ctx.moveTo(x + 16, y - 16);
            ctx.lineTo(x - 16, y + 16);
            ctx.stroke();
          } else {
            circle(x, y, 13, color);
            circle(x, y, radius - 12, "", "#ffffff18");
          }
        }
        if (v.points[userId] > previousPoints)
          feedbackUntil = performance.now() + 180;
        previousPoints = v.points[userId];
        if (performance.now() < feedbackUntil) {
          ctx.strokeStyle = `rgba(200,243,106,${(feedbackUntil - performance.now()) / 800})`;
          ctx.lineWidth = 5;
          ctx.strokeRect(3, 3, 994, 994);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [timeline, userId]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
    };
  };
  return (
    <canvas
      ref={canvas}
      className={`shared-field ${view.discipline}`}
      role="img"
      aria-label={
        view.discipline === "dodge"
          ? "Shared dodge arena. Use WASD, arrows, or drag to move."
          : "Moving target arena. Hit circles, avoid crossed decoys."
      }
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown(point(e));
      }}
      onPointerMove={(e) => {
        if (e.buttons) onMove(point(e));
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
