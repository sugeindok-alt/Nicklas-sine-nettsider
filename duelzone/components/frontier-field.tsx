"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Shield,
  Zap,
  RotateCcw,
  Trophy,
} from "lucide-react";
import {
  Frontier,
  FRONTIER_INFO,
  neutral,
  moveFighter,
  clamp,
  type FrontierGame,
  type FrontierView,
  type Fighter,
  type Control,
} from "@/lib/frontier";
import { FrontierBot } from "@/lib/frontier-bot";
import { network } from "@/lib/match-feed";
import type { MatchState, Player, Game } from "@/lib/shared";
import type { Action } from "@/server/game";
import { tone, unlockSound } from "@/lib/sound";

const colors = ["#c8f36a", "#9cb9ee"];
const primaryLabels = {
  knockout: "Shove",
  ball: "Shoot",
  grapple: "Grapple",
  shadow: "Scan",
  core: "Pulse",
};
export function SeriesRecap({
  view,
  players,
}: {
  view: FrontierView;
  players: Player[];
}) {
  return (
    <div className="series-recap">
      <span className="eyebrow">
        {view.series ? "SERIES BREAKDOWN" : "MATCH STATISTICS"}
      </span>
      {view.history.map((r, i) => (
        <div key={i}>
          <span>{String(i + 1).padStart(2, "0")}</span>
          <strong>{FRONTIER_INFO[r.game].name}</strong>
          <span>{players.map((p) => r.scores[p.id]).join(" : ")}</span>
          <span>
            {r.winner
              ? players.find((p) => p.id === r.winner)?.username
              : "Draw"}
          </span>
        </div>
      ))}
      <div className="frontier-stats">
        {players.map((p) => {
          const stats = view.history.reduce(
            (sum, r) => {
              const s = r.stats[p.id];
              return {
                hits: sum.hits + (s?.hits || 0),
                dashes: sum.dashes + (s?.dashes || 0),
                goals: sum.goals + (s?.goals || 0),
              };
            },
            { hits: 0, dashes: 0, goals: 0 },
          );
          return (
            <span key={p.id}>
              <b>{p.username}</b>
              {stats?.hits || 0} hits · {stats?.dashes || 0} dashes
              {view.game === "ball" ? ` · ${stats?.goals || 0} goals` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function render(
  ctx: CanvasRenderingContext2D,
  v: FrontierView,
  players: Player[],
  userId: string,
  camera: number,
  time: number,
  effects: { id: number; born: number },
) {
  const width = 1000,
    height = 600;
  ctx.fillStyle = "#0d1013";
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(-camera, 0);
  const line = (
    x: number,
    y: number,
    x2: number,
    y2: number,
    color = "#262d33",
    w = 1,
  ) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const circle = (
    x: number,
    y: number,
    r: number,
    fill: string,
    stroke?: string,
  ) => {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  };
  const text = (
    s: string,
    x: number,
    y: number,
    color = "#76828c",
    size = 11,
  ) => {
    ctx.fillStyle = color;
    ctx.font = `500 ${size}px Inter, Arial, sans-serif`;
    ctx.fillText(s, x, y);
  };
  for (let x = Math.floor(camera / 50) * 50; x < camera + width; x += 50)
    line(x, 0, x, height, "#161d23");
  for (let y = 0; y < height; y += 50)
    line(camera, y, camera + width, y, "#161d23");
  if (v.game === "knockout") {
    circle(500, 300, v.ring + 24, "#191d21", "#30383f");
    circle(500, 300, v.ring, "#22292b", "#b2c296");
    ctx.setLineDash([5, 10]);
    circle(500, 300, Math.max(20, v.ring - 35), "transparent", "#3b4541");
    ctx.setLineDash([]);
    line(480, 300, 520, 300, "#697267");
    line(500, 280, 500, 320, "#697267");
    text("APERTURE", 448, 315 + v.ring + 32);
    text("OUTSIDE = RING-OUT", 24, 575);
  }
  if (v.game === "ball") {
    ctx.fillStyle = "#141e22";
    ctx.fillRect(14, 14, 972, 572);
    ctx.strokeStyle = "#526168";
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 972, 572);
    line(500, 14, 500, 586, "#526168");
    circle(500, 300, 85, "transparent", "#526168");
    circle(500, 300, 4, "#7c8a8f");
    for (let i = 0; i < 2; i++) {
      const x = i ? 900 : 14;
      ctx.strokeStyle = colors[i];
      ctx.strokeRect(x, 200, 86, 200);
      ctx.fillStyle = colors[i] + "25";
      ctx.fillRect(i ? 970 : 0, 220, 30, 160);
      for (let y = 225; y < 380; y += 15)
        line(i ? 972 : 0, y, i ? 1000 : 28, y, colors[i] + "70");
    }
    text("ATTACK →", 105, 40, colors[0]);
    text("← ATTACK", 805, 40, colors[1]);
    const b = v.ball;
    line(b.x - b.vx * 0.035, b.y - b.vy * 0.035, b.x, b.y, "#e3e8e944", 12);
    circle(b.x, b.y + 5, 15, "#0006");
    circle(b.x, b.y, 13, "#e4e8eb", "#9caab5");
    circle(b.x, b.y, 5, "#45525d");
  }
  if (v.game === "core") {
    const ids = players.filter((p) => {
      const f = v.players[p.id];
      return f && Math.hypot(f.x - v.objective.x, f.y - v.objective.y) < 86;
    });
    const color =
      ids.length === 1
        ? colors[players.findIndex((p) => p.id === ids[0].id)]
        : "#87989e";
    circle(v.objective.x, v.objective.y, 86, color + "18", color);
    circle(
      v.objective.x,
      v.objective.y,
      68 + Math.sin(time / 350) * 3,
      "transparent",
      color + "60",
    );
    text(
      ids.length > 1 ? "CONTESTED" : "CONTROL",
      v.objective.x - 34,
      v.objective.y + 5,
      color,
    );
  }
  if (v.game === "grapple") {
    for (const a of v.anchors) {
      line(a.x, 0, a.x, a.y, "#4c565d", 2);
      circle(a.x, a.y, 11, "#141a1e", "#a6b5c1");
      circle(a.x, a.y, 3, "#e8b39a");
    }
    for (const [i, c] of v.checkpoints.entries()) {
      line(c.x, c.y, c.x, c.y - 65, "#788c7b", 2);
      ctx.fillStyle = "#c8f36a";
      ctx.fillRect(c.x, c.y - 65, 22, 14);
      text(`CP ${i + 1}`, c.x - 12, c.y + 45);
    }
    ctx.fillStyle = "#c8f36a18";
    ctx.fillRect(v.width - 150, 40, 65, 500);
    line(v.width - 150, 40, v.width - 150, 540, "#c8f36a", 3);
    text("FINISH", v.width - 180, 33, "#c8f36a");
  }
  if (v.game === "shadow") {
    const hunter = v.players[v.hunter];
    if (!hunter.hidden)
      circle(hunter.x, hunter.y, 245, "#afb9c807", "#afb9c81c");
    for (const r of v.relics) {
      ctx.strokeStyle = r.taken ? "#39454b" : "#c2b4df";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 13, r.y - 13, 26, 26);
      if (!r.taken) {
        circle(r.x, r.y, 5, "#c2b4df");
        text("DATA", r.x - 14, r.y + 32, "#c2b4df");
      }
    }
    circle(120, 300, 50, "#c8f36a10", "#c8f36a66");
    text("EXTRACT", 93, 305, "#c8f36a");
  }
  for (const w of v.walls) {
    ctx.fillStyle = "#101316";
    ctx.fillRect(w.x + 5, w.y + 7, w.w, w.h);
    ctx.fillStyle = "#293139";
    ctx.fillRect(w.x, w.y, w.w, w.h);
    line(w.x, w.y, w.x + w.w, w.y, "#65737d", 2);
    ctx.strokeStyle = "#39444d";
    ctx.lineWidth = 1;
    ctx.strokeRect(w.x, w.y, w.w, w.h);
  }
  for (const [i, player] of players.entries()) {
    const p = v.players[player.id];
    if (!p || p.hidden) continue;
    const color = colors[i],
      self = player.id === userId;
    if (p.hook) {
      line(p.x, p.y, p.hook.x, p.hook.y, color + "cc", 2);
      circle(p.hook.x, p.hook.y, 15, "transparent", color);
    }
    if (v.now < p.dashUntil)
      line(p.x - p.vx * 0.05, p.y - p.vy * 0.05, p.x, p.y, color + "50", 20);
    circle(p.x, p.y + 7, 19, "#0005");
    circle(p.x, p.y, 17, "#182025", color);
    circle(p.x, p.y, 10, color + "bb");
    if (self) circle(p.x, p.y, 24, "transparent", color + "48");
    if (p.invulnerable > v.now) {
      ctx.setLineDash([3, 6]);
      circle(p.x, p.y, 27, "transparent", "#b8c9d555");
      ctx.setLineDash([]);
    }
    const aim = p.facing;
    line(
      p.x + aim.x * 21,
      p.y + aim.y * 21,
      p.x + aim.x * (p.charge ? 35 + p.charge * 45 : 31),
      p.y + aim.y * (p.charge ? 35 + p.charge * 45 : 31),
      color,
      p.charge ? 4 : 2,
    );
    if (p.input.secondary && p.energy > 0) {
      ctx.beginPath();
      const angle = Math.atan2(aim.y, aim.x);
      ctx.arc(p.x, p.y, 30, angle - 1, angle + 1);
      ctx.strokeStyle = "#e1e8ed";
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.textAlign = "center";
    text(
      self ? "YOU" : player.bot ? "BOT" : player.username.slice(0, 14),
      p.x,
      p.y - 32,
      color,
      10,
    );
    ctx.textAlign = "left";
    if (v.game === "core") {
      ctx.fillStyle = "#20262b";
      ctx.fillRect(p.x - 20, p.y + 28, 40, 3);
      ctx.fillStyle = color;
      ctx.fillRect(p.x - 20, p.y + 28, (40 * p.hp) / 100, 3);
    }
  }
  const age = time - effects.born;
  if (v.event.id === effects.id && age < 700 && v.event.kind !== "stage")
    circle(
      v.event.x,
      v.event.y,
      20 + age * 0.11,
      "transparent",
      `rgba(225,233,232,${Math.max(0, 0.7 - age / 1000)})`,
    );
  ctx.restore();
  if (v.game === "grapple") {
    ctx.fillStyle = "#0c1014dd";
    ctx.fillRect(690, 15, 290, 36);
    for (const [i, p] of players.entries()) {
      const f = v.players[p.id];
      ctx.fillStyle = colors[i];
      ctx.fillRect(700, 23 + i * 13, Math.max(1, (f.x / v.width) * 270), 3);
    }
  }
}

export function FrontierField({
  state,
  userId,
  onAction,
  readOnly = false,
  practice = false,
}: {
  state: MatchState;
  userId: string;
  onAction: (action: Action) => void;
  readOnly?: boolean;
  practice?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    control = useRef(neutral()),
    keys = useRef(new Set<string>());
  const latest = useRef({ state, onAction });
  latest.current = { state, onAction };
  const frames = useRef<{ v: FrontierView; local: number }[]>([]),
    pending = useRef<{ control: Control; at: number }[]>([]);
  const sequence = useRef(Date.now()),
    last = useRef({ data: "", at: 0 }),
    predicted = useRef<Fighter | null>(null),
    camera = useRef(0);
  const effect = useRef({ id: 0, born: 0 }),
    stage = useRef(""),
    pointer = useRef(false);
  const [clock, setClock] = useState(Date.now());
  const v = state.frontier!,
    player = v.players[userId];
  useEffect(() => {
    const now = Date.now(),
      key = `${v.round}:${v.startedAt}`;
    if (stage.current !== key) {
      stage.current = key;
      frames.current = [];
      pending.current = [];
      predicted.current = null;
      camera.current = 0;
      keys.current.clear();
      control.current = neutral();
    }
    frames.current.push({ v, local: now });
    frames.current = frames.current.slice(-8);
    pending.current = pending.current.filter(
      (p) => p.control.seq > (v.players[userId]?.ack || 0),
    );
    if (effect.current.id !== v.event.id) {
      effect.current = { id: v.event.id, born: now };
      tone(
        v.event.kind === "goal"
          ? "win"
          : v.event.kind === "stage"
            ? "stage"
            : "hit",
      );
    }
  }, [v.now, v.round, userId]);
  const send = () => {
    if (readOnly) return;
    const { state, onAction } = latest.current;
    if (!state.challenge || state.phase !== "active") return;
    if (document.querySelector(".social-panel")) {
      keys.current.clear();
      control.current = neutral();
    }
    const c = control.current,
      encoded = JSON.stringify({ ...c, seq: 0 }),
      now = Date.now();
    if (encoded === last.current.data && now - last.current.at < 120) return;
    c.seq = ++sequence.current;
    last.current = { data: encoded, at: now };
    pending.current.push({ control: { ...c }, at: now });
    pending.current = pending.current.slice(-40);
    onAction({ challengeId: state.challenge.id, ...c });
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const update = () => {
      const k = keys.current,
        c = control.current;
      c.dx =
        Number(k.has("d") || k.has("arrowright")) -
        Number(k.has("a") || k.has("arrowleft"));
      c.dy =
        Number(k.has("s") || k.has("arrowdown")) -
        Number(k.has("w") || k.has("arrowup"));
      if (!pointer.current && (c.dx || c.dy)) {
        const d = Math.hypot(c.dx, c.dy);
        c.aimX = c.dx / d;
        c.aimY = c.dy / d;
      }
      c.primary = k.has("j");
      c.secondary = k.has("k");
      c.ability = k.has(" ");
      c.jump = k.has("w") || k.has("arrowup");
    };
    const down = (e: KeyboardEvent) => {
      if (
        readOnly ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        document.querySelector(".social-panel")
      )
        return;
      const key = e.key.toLowerCase();
      if (
        ![
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          " ",
          "j",
          "k",
        ].includes(key)
      )
        return;
      e.preventDefault();
      keys.current.add(key);
      update();
      unlockSound();
      if (!e.repeat) sendRef.current();
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase());
      update();
      sendRef.current();
    };
    const reset = () => {
      keys.current.clear();
      control.current = neutral();
      pointer.current = false;
      sendRef.current();
    };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    const inputs = setInterval(() => sendRef.current(), 50),
      hud = setInterval(() => setClock(Date.now()), 100);
    return () => {
      clearInterval(inputs);
      clearInterval(hud);
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
    };
  }, [readOnly, userId]);
  useEffect(() => {
    const element = canvas.current,
      ctx = element?.getContext("2d");
    if (!ctx || !element) return;
    let handle = 0,
      previous = performance.now();
    const draw = (t: number) => {
      const item = frames.current.at(-1);
      if (item) {
        const now = Date.now(),
          elapsed = Math.min(
            200,
            now - item.local + (practice ? 0 : network.rtt / 2),
          );
        const view = {
            ...item.v,
            players: { ...item.v.players },
            ball: { ...item.v.ball },
          },
          dt = clamp((t - previous) / 1000, 0, 0.05);
        const renderAt = item.v.now + elapsed - (practice ? 0 : 100);
        const before =
          [...frames.current].reverse().find((f) => f.v.now <= renderAt)?.v ||
          frames.current[0].v;
        const after =
          frames.current.find((f) => f.v.now >= renderAt)?.v || item.v;
        const blend = clamp(
          (renderAt - before.now) / Math.max(1, after.now - before.now),
          0,
          1,
        );
        for (const id of Object.keys(view.players)) {
          const p = view.players[id];
          if (id !== userId || readOnly) {
            const a = before.players[id] || p,
              b = after.players[id] || p;
            if (!p.hidden && a.teleports === b.teleports)
              view.players[id] = {
                ...p,
                x: a.x + (b.x - a.x) * blend,
                y: a.y + (b.y - a.y) * blend,
              };
            continue;
          }
          const target = {
            ...p,
            facing: { x: control.current.aimX, y: control.current.aimY },
            input: { ...control.current },
          };
          if (
            !view.transitionUntil &&
            view.now >= view.resetUntil &&
            !view.ended
          ) {
            const unacked = pending.current;
            let input = { ...p.input },
              from = view.now;
            const offset =
              view.now -
              item.local +
              (practice ? 0 : Math.min(150, network.rtt / 2));
            const advance = (end: number) => {
              while (from < end) {
                const step = Math.min(1000 / 60, end - from);
                moveFighter(target, view, input, step / 1000, from + step);
                from += step;
              }
            };
            for (const change of unacked) {
              const at = clamp(change.at + offset, from, view.now + elapsed);
              advance(at);
              input = change.control;
            }
            advance(view.now + elapsed);
          }
          const current = predicted.current;
          if (
            !current ||
            p.teleports !== current.teleports ||
            Math.hypot(current.x - target.x, current.y - target.y) > 130 ||
            view.transitionUntil ||
            view.resetUntil > view.now
          )
            predicted.current = target;
          else {
            const weight = 1 - Math.exp(-22 * dt);
            predicted.current = {
              ...target,
              x: current.x + (target.x - current.x) * weight,
              y: current.y + (target.y - current.y) * weight,
            };
          }
          view.players[id] = predicted.current!;
        }
        if (
          before.round === after.round &&
          Math.hypot(
            after.ball.x - before.ball.x,
            after.ball.y - before.ball.y,
          ) < 200
        ) {
          view.ball.x = before.ball.x + (after.ball.x - before.ball.x) * blend;
          view.ball.y = before.ball.y + (after.ball.y - before.ball.y) * blend;
        }
        const targetCamera =
          view.game === "grapple"
            ? clamp((view.players[userId]?.x || 0) - 280, 0, view.width - 1000)
            : 0;
        camera.current +=
          (targetCamera - camera.current) * (1 - Math.exp(-8 * dt));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (element.width !== 1000 * dpr) {
          element.width = 1000 * dpr;
          element.height = 600 * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        render(
          ctx,
          view,
          latest.current.state.players,
          userId,
          camera.current,
          now,
          effect.current,
        );
      }
      previous = t;
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [userId, readOnly, practice]);
  const now =
    v.now + Math.min(250, clock - (frames.current.at(-1)?.local || clock));
  const touch = (field: keyof Control, value: number | boolean) => {
    if (readOnly) return;
    unlockSound();
    (control.current as any)[field] = value;
    if (field === "dx" && value) {
      control.current.aimX = Number(value);
      control.current.aimY = 0;
    }
    if (field === "dy" && value) {
      control.current.aimY = Number(value);
      control.current.aimX = 0;
    }
    sendRef.current();
  };
  const hold = (field: keyof Control, value: number | boolean = true) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      touch(field, value);
    },
    onPointerUp: () => touch(field, typeof value === "boolean" ? false : 0),
    onPointerCancel: () => touch(field, typeof value === "boolean" ? false : 0),
    onLostPointerCapture: () =>
      touch(field, typeof value === "boolean" ? false : 0),
  });
  return (
    <div className="frontier-field">
      <div className="frontier-heading">
        <div>
          <span className="eyebrow">
            {practice
              ? "PRACTICE · AI BOT"
              : readOnly
                ? "LIVE SPECTATOR"
                : v.series
                  ? `SHOWDOWN / ROUND ${v.round} OF 5`
                  : v.map}
          </span>
          <h3>{FRONTIER_INFO[v.game].name}</h3>
        </div>
        <div className="frontier-timer">
          <b>{Math.max(0, Math.ceil((v.deadline - now) / 1000))}</b>
          <span>SECONDS</span>
        </div>
      </div>
      {v.series && (
        <div className="showdown-progress">
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={
                i === v.round - 1
                  ? "current"
                  : i < v.round - 1
                    ? "complete"
                    : ""
              }
            >
              {v.history[i]
                ? FRONTIER_INFO[v.history[i].game].short
                : i === v.round - 1
                  ? FRONTIER_INFO[v.game].short
                  : "?"}
            </span>
          ))}
          <b>{state.players.map((p) => v.seriesScore[p.id]).join(" — ")}</b>
        </div>
      )}
      <div className="frontier-stage">
        <canvas
          ref={canvas}
          aria-label={`${FRONTIER_INFO[v.game].name} live arena. ${FRONTIER_INFO[v.game].keys}`}
          onContextMenu={(e) => e.preventDefault()}
          onPointerMove={(e) => {
            if (readOnly || e.pointerType === "touch") return;
            const box = e.currentTarget.getBoundingClientRect(),
              p = predicted.current || player;
            if (!p) return;
            const dx =
                ((e.clientX - box.left) / box.width) * 1000 +
                camera.current -
                p.x,
              dy = ((e.clientY - box.top) / box.height) * 600 - p.y,
              d = Math.hypot(dx, dy) || 1;
            pointer.current = true;
            control.current.aimX = dx / d;
            control.current.aimY = dy / d;
          }}
          onPointerLeave={() => {
            pointer.current = false;
          }}
          onPointerDown={(e) => {
            if (readOnly || e.pointerType === "touch") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            touch(e.button === 2 ? "secondary" : "primary", true);
          }}
          onPointerUp={(e) =>
            touch(e.button === 2 ? "secondary" : "primary", false)
          }
          onPointerCancel={() => {
            touch("primary", false);
            touch("secondary", false);
          }}
        />
        <div className="frontier-live-score">
          {state.players.map((p, i) => (
            <span style={{ color: colors[i] }} key={p.id}>
              {p.id === userId && !readOnly
                ? "YOU"
                : p.bot
                  ? "BOT"
                  : p.username}
              <b>{v.points[p.id]}</b>
            </span>
          ))}
        </div>
        {v.game === "shadow" && (
          <div className="frontier-role">
            LEG {v.leg}/2 ·{" "}
            {v.hunter === userId ? "YOU ARE THE HUNTER" : "YOU ARE THE RUNNER"}{" "}
            · {Math.max(0, Math.ceil((v.legEnds - now) / 1000))}s
          </div>
        )}
        <AnimatePresence>
          {v.resetUntil > now && !v.transitionUntil && (
            <motion.div
              className="frontier-countdown"
              key={`count-${v.resetUntil}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <b>{Math.max(1, Math.ceil((v.resetUntil - now) / 1000))}</b>
              <span>READ THE ARENA</span>
            </motion.div>
          )}
          {v.transitionUntil > 0 && (
            <motion.div
              className="frontier-intermission"
              key={`round-${v.round}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <Trophy size={28} />
              <span className="eyebrow">ROUND {v.round} COMPLETE</span>
              <h3>
                {v.history.at(-1)?.winner
                  ? `${state.players.find((p) => p.id === v.history.at(-1)?.winner)?.username} takes the round.`
                  : "Evenly matched."}
              </h3>
              <p>
                {state.players.map((p) => v.seriesScore[p.id]).join(" — ")} ·
                Next discipline in{" "}
                {Math.max(1, Math.ceil((v.transitionUntil - now) / 1000))}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        {!v.transitionUntil &&
          v.event.kind === "goal" &&
          clock - effect.current.born < 1500 && (
            <motion.div
              key={v.event.id}
              className="frontier-event"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {v.event.text}
            </motion.div>
          )}
      </div>
      {!readOnly && (
        <>
          <div className="frontier-controls">
            <div className="frontier-dpad">
              <button aria-label="Move up" {...hold("dy", -1)}>
                <ArrowUp size={16} />
              </button>
              <button aria-label="Move left" {...hold("dx", -1)}>
                <ArrowLeft size={16} />
              </button>
              <button aria-label="Move down" {...hold("dy", 1)}>
                <ArrowDown size={16} />
              </button>
              <button aria-label="Move right" {...hold("dx", 1)}>
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="frontier-actions">
              {v.game === "grapple" && (
                <button {...hold("jump")}>
                  <ArrowUp size={17} /> Jump <kbd>W</kbd>
                </button>
              )}
              <button {...hold("ability")}>
                <Zap size={17} /> Dash <kbd>SPACE</kbd>
                <i
                  style={{
                    transform: `scaleX(${clamp(1 - ((player?.dashReady || 0) - now) / 1500, 0, 1)})`,
                  }}
                />
              </button>
              <button {...hold("primary")}>
                <Crosshair size={17} />
                {primaryLabels[v.game]} <kbd>J</kbd>
                <i
                  style={{
                    transform: `scaleX(${(player?.charge || 0) / 0.9})`,
                  }}
                />
              </button>
              {v.game !== "grapple" && (
                <button {...hold("secondary")}>
                  <Shield size={17} />
                  {v.game === "shadow"
                    ? "Sneak"
                    : v.game === "ball"
                      ? "Brake"
                      : "Block"}{" "}
                  <kbd>K</kbd>
                </button>
              )}
            </div>
          </div>
          <div className="frontier-energy">
            <span>ENERGY</span>
            <div>
              <i style={{ width: `${player?.energy || 0}%` }} />
            </div>
            <span>{Math.round(player?.energy || 0)}%</span>
            <span className="network-label">
              {practice ? "LOCAL PRACTICE" : `${Math.round(network.rtt)} MS`}
            </span>
          </div>
        </>
      )}
      <p className="frontier-instructions">
        {FRONTIER_INFO[v.game].description}
      </p>
    </div>
  );
}

export function FrontierPractice({
  game,
  onClose,
}: {
  game: Game;
  onClose: () => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState<MatchState | null>(null),
    engine = useRef<Frontier | null>(null);
  const players: Player[] = [
    { id: "practice", username: "You", accent: colors[0], bio: "" },
    {
      id: "practice-bot",
      username: "Practice AI",
      accent: colors[1],
      bio: "",
      bot: true,
    },
  ];
  useEffect(() => {
    const e = new Frontier(
      game as FrontierGame,
      players.map((p) => p.id),
      Date.now(),
    );
    engine.current = e;
    const bot = new FrontierBot("practice-bot", "medium");
    const tick = () => {
      const now = Date.now();
      const action = bot.think(e.snapshot(bot.id), now);
      if (action) e.action(bot.id, action, now);
      e.tick(now);
      const scores = e.scores();
      setState({
        id: "practice",
        game,
        mode: "ai",
        phase: e.view.ended ? "finished" : "active",
        players,
        scores,
        answered: [],
        round: e.view.round,
        rounds: game === "showdown" ? 5 : 1,
        serverNow: now,
        startedAt: e.view.startedAt,
        deadline: e.view.deadline,
        challenge: { id: "practice" },
        feedback: {},
        winner: e.view.ended
          ? scores.practice === scores[bot.id]
            ? null
            : scores.practice > scores[bot.id]
              ? "practice"
              : bot.id
          : null,
        rematch: [],
        frontier: e.snapshot("practice"),
      });
    };
    tick();
    const timer = setInterval(tick, 1000 / 30);
    return () => clearInterval(timer);
  }, [game, attempt]);
  if (!state) return null;
  return (
    <div className="frontier-practice">
      {state.phase === "finished" ? (
        <>
          <h2>
            {state.winner === "practice"
              ? "Well played."
              : state.winner
                ? "Find your next opening."
                : "Perfectly matched."}
          </h2>
          <SeriesRecap view={state.frontier!} players={players} />
          <div className="result-actions">
            <button
              className="button primary"
              onClick={() => setAttempt((x) => x + 1)}
            >
              <RotateCcw size={16} /> Practice again
            </button>
            <button className="button secondary" onClick={onClose}>
              Back to arena
            </button>
          </div>
        </>
      ) : (
        <FrontierField
          state={state}
          userId="practice"
          practice
          onAction={(action) =>
            engine.current?.action("practice", action, Date.now())
          }
        />
      )}
    </div>
  );
}
