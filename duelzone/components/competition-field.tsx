"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  Shield,
  Zap,
  Trophy,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Competition } from "@/lib/competition";
import { GAME_INFO, type Game, type MatchState } from "@/lib/shared";
import type { Action } from "@/server/game";
import { tone, unlockSound } from "@/lib/sound";

const labels = {
  dodge: "DODGE DUEL",
  grid: "GRID RUSH",
  clash: "AIM CLASH",
  mind: "MIND BATTLE",
};
export function CompetitionField({
  state,
  userId,
  onAction,
  practice = false,
}: {
  state: MatchState;
  userId: string;
  onAction: (action: Action) => void;
  practice?: boolean;
}) {
  const view = state.competition!,
    player = view.players[userId];
  const [clock, setClock] = useState(Date.now()),
    [pulse, setPulse] = useState(0);
  const received = useRef({ local: Date.now(), server: view.now });
  const latest = useRef({ state, onAction });
  latest.current = { state, onAction };
  const pressed = useRef(new Set<string>()),
    pointer = useRef<{ x: number; y: number } | null>(null);
  const previous = useRef({
    points: view.points[userId],
    hp: player?.hp,
    stage: view.stage,
  });
  useEffect(() => {
    received.current = { local: Date.now(), server: view.now };
  }, [view.now]);
  useEffect(() => {
    let frame: number;
    const update = () => {
      setClock(Date.now());
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);
  const now =
    received.current.server + Math.max(0, clock - received.current.local);
  const extrapolate = Math.min(
    0.1,
    Math.max(0, clock - received.current.local) / 1000,
  );
  const send = (action: Partial<Action>, gesture = true) => {
    const current = latest.current;
    if (!current.state.challenge || current.state.phase !== "active") return;
    if (gesture) unlockSound();
    current.onAction({
      challengeId: current.state.challenge.id,
      puzzleId: current.state.competition?.puzzle?.id,
      ...action,
    });
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const key = e.key.toLowerCase();
      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          " ",
        ].includes(key)
      ) {
        e.preventDefault();
        pressed.current.add(key);
        unlockSound();
      }
      if (key === " " && !e.repeat) sendRef.current({ ability: true });
      if (/^[1-4]$/.test(key) && !e.repeat)
        sendRef.current({ choice: Number(key) - 1 });
    };
    const keyup = (e: KeyboardEvent) =>
      pressed.current.delete(e.key.toLowerCase());
    const reset = () => {
      pressed.current.clear();
      pointer.current = null;
      sendRef.current({ dx: 0, dy: 0 }, false);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("keyup", keyup);
    window.addEventListener("blur", reset);
    const timer = setInterval(() => {
      const v = latest.current.state.competition,
        p = v?.players[userId];
      if (!v || !p || v.discipline !== "dodge") return;
      let dx =
        Number(pressed.current.has("d") || pressed.current.has("arrowright")) -
        Number(pressed.current.has("a") || pressed.current.has("arrowleft"));
      let dy =
        Number(pressed.current.has("s") || pressed.current.has("arrowdown")) -
        Number(pressed.current.has("w") || pressed.current.has("arrowup"));
      if (pointer.current) {
        const x = pointer.current.x - p.x,
          y = pointer.current.y - p.y,
          length = Math.hypot(x, y);
        dx = length > 0.02 ? x / length : 0;
        dy = length > 0.02 ? y / length : 0;
      }
      sendRef.current({ dx, dy }, false);
    }, 70);
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", reset);
    };
  }, [userId]);
  useEffect(() => {
    if (view.stage !== previous.current.stage) {
      tone("stage");
      pressed.current.clear();
      pointer.current = null;
    } else if (
      view.points[userId] > previous.current.points &&
      view.discipline !== "dodge"
    ) {
      tone("hit");
      setPulse((p) => p + 1);
    } else if (
      player.hp < previous.current.hp! ||
      view.points[userId] < previous.current.points
    )
      tone("miss");
    previous.current = {
      points: view.points[userId],
      hp: player.hp,
      stage: view.stage,
    };
  }, [view.stage, view.points, view.discipline, userId, player.hp]);
  const abilityReady =
    now >= player.readyAt &&
    (view.discipline === "dodge" ? player.hp > 0 : player.energy >= 3);
  const remaining = Math.max(0, view.stageEnds - now),
    puzzle = view.puzzle;
  const palette = (id: string) => (id === userId ? "#c8f36a" : "#a5bce9");
  const position = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };
  return (
    <div className={`competition-field discipline-${view.discipline}`}>
      <div className="competition-top">
        <span>
          <i className="status-dot" />
          {practice ? "SOLO TRAINING" : "LIVE 1V1"}
        </span>
        <b>{labels[view.discipline]}</b>
        <span className={remaining < 5000 ? "urgent" : ""}>
          {(remaining / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="stage-rail">
        {Array.from({ length: view.stages }, (_, i) => (
          <span key={i} className={i + 1 <= view.stage ? "filled" : ""} />
        ))}
      </div>
      <div className="competition-stats">
        <span>
          {view.discipline === "dodge"
            ? `${"● ".repeat(player.hp)}${"○ ".repeat(3 - player.hp)} LIVES`
            : view.discipline === "grid"
              ? `${view.tiles.filter((id) => id === userId).length} TILES`
              : `${player.combo} STREAK`}
        </span>
        <motion.strong
          key={pulse}
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
        >
          {view.points[userId].toLocaleString()} <small>PTS</small>
        </motion.strong>
        <span>
          {view.stages > 1
            ? `STAGE ${view.stage} / ${view.stages}`
            : view.discipline === "mind"
              ? `PUZZLE ${puzzle?.number} / 6`
              : `ENERGY ${player.energy}/6`}
        </span>
      </div>
      <div className="competition-surface">
        {(view.discipline === "dodge" || view.discipline === "clash") && (
          <svg
            className={`shared-field ${view.discipline}`}
            viewBox="0 0 1000 1000"
            role="img"
            aria-label={
              view.discipline === "dodge"
                ? "Shared dodge arena. Use WASD, arrows, or drag to move."
                : "Moving target arena. Hit circles, avoid crossed decoys."
            }
            onPointerDown={(e) => {
              unlockSound();
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = position(e);
              if (view.discipline === "dodge") pointer.current = p;
              else send(p);
            }}
            onPointerMove={(e) => {
              if (e.buttons && view.discipline === "dodge")
                pointer.current = position(e);
            }}
            onPointerUp={() => {
              pointer.current = null;
            }}
            onPointerCancel={() => {
              pointer.current = null;
            }}
          >
            <defs>
              <pattern
                id="competition-lines"
                width="100"
                height="100"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M100 0H0V100"
                  fill="none"
                  stroke="#ffffff08"
                  strokeWidth="2"
                />
              </pattern>
            </defs>
            <rect width="1000" height="1000" fill="url(#competition-lines)" />
            <path
              d="M470 500h60M500 470v60"
              stroke="#ffffff13"
              strokeWidth="2"
            />
            {view.discipline === "dodge" && (
              <>
                {view.hazards.map((h) =>
                  now < h.activeAt ? (
                    <g key={h.id} opacity=".65">
                      <circle
                        cx={Math.min(0.97, Math.max(0.03, h.x)) * 1000}
                        cy={Math.min(0.97, Math.max(0.03, h.y)) * 1000}
                        r="24"
                        fill="none"
                        stroke="#e8b39a"
                        strokeDasharray="6 6"
                      />
                      <path
                        d={`M${Math.min(0.97, Math.max(0.03, h.x)) * 1000} ${Math.min(0.97, Math.max(0.03, h.y)) * 1000} l${h.vx * 150} ${h.vy * 150}`}
                        stroke="#e8b39a"
                        strokeWidth="5"
                      />
                    </g>
                  ) : (
                    <circle
                      key={h.id}
                      cx={(h.x + h.vx * extrapolate) * 1000}
                      cy={(h.y + h.vy * extrapolate) * 1000}
                      r={h.radius * 1000}
                      fill="#e8b39a"
                    />
                  ),
                )}
                {Object.entries(view.players).map(([id, p]) => {
                  const moving =
                    p.hp > 0 &&
                    now - p.lastInput < 300 &&
                    !view.ended &&
                    now >= view.transitionUntil;
                  const distance = moving
                    ? (extrapolate * (now < p.dashUntil ? 1.1 : 0.45)) /
                      Math.max(1, Math.hypot(p.dx, p.dy))
                    : 0;
                  const x = Math.max(
                    0.025,
                    Math.min(0.975, p.x + p.dx * distance),
                  );
                  const y = Math.max(
                    0.025,
                    Math.min(0.975, p.y + p.dy * distance),
                  );
                  return (
                    <g
                      key={id}
                      opacity={p.hp ? 1 : 0.2}
                      transform={`translate(${x * 1000} ${y * 1000})`}
                    >
                      {p.shieldUntil > now && (
                        <circle
                          cx={0}
                          cy={0}
                          r="38"
                          fill="none"
                          stroke={palette(id)}
                          strokeWidth="2"
                          strokeDasharray="8 5"
                        />
                      )}
                      <circle cx={0} cy={0} r="22" fill={palette(id)} />
                      <text
                        x={0}
                        y={-48}
                        textAnchor="middle"
                        fill={palette(id)}
                        fontSize="22"
                        fontFamily="sans-serif"
                      >
                        {id === userId ? "YOU" : "RIVAL"}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
            {view.discipline === "clash" &&
              view.targets.map((t) => (
                <g
                  key={t.id}
                  transform={`translate(${(t.x + t.vx * extrapolate) * 1000} ${(t.y + t.vy * extrapolate) * 1000})`}
                  className={`clash-target ${t.kind}`}
                >
                  <circle
                    r={t.radius * 1000 * (now < player.focusUntil ? 1.5 : 1)}
                    fill={t.kind === "decoy" ? "#e8b39a0d" : "#ffffff06"}
                    stroke={
                      t.kind === "power"
                        ? "#dec681"
                        : t.kind === "decoy"
                          ? "#e8b39a"
                          : "#c8f36a"
                    }
                    strokeWidth="3"
                  />
                  {t.kind === "decoy" ? (
                    <path
                      d="M-16-16l32 32M16-16l-32 32"
                      stroke="#e8b39a"
                      strokeWidth="5"
                    />
                  ) : (
                    <>
                      <circle
                        r="13"
                        fill={t.kind === "power" ? "#dec681" : "#c8f36a"}
                      />
                      <circle
                        r={t.radius * 1000 - 12}
                        fill="none"
                        stroke="#ffffff18"
                        strokeWidth="2"
                      />
                    </>
                  )}
                </g>
              ))}
          </svg>
        )}
        {view.discipline === "grid" && (
          <div
            className="capture-grid"
            role="group"
            aria-label="Territory grid"
          >
            {view.tiles.map((owner, tile) => {
              const adjacent = [
                tile - 7,
                tile + 7,
                ...(tile % 7 ? [tile - 1] : []),
                ...(tile % 7 < 6 ? [tile + 1] : []),
              ].some((n) => n >= 0 && n < 49 && view.tiles[n] === userId);
              const fortified = (view.fortified[tile] || 0) > now;
              return (
                <button
                  key={tile}
                  aria-label={`Tile ${tile + 1}, ${owner === userId ? "yours" : owner ? "rival" : "neutral"}${tile === view.bonusTile ? ", bonus" : ""}`}
                  className={`${owner === userId ? "owned" : owner ? "rival" : ""} ${adjacent && owner !== userId ? "available" : ""} ${tile === view.bonusTile ? "bonus" : ""}`}
                  disabled={owner === userId || !adjacent || fortified}
                  onClick={() => send({ tile })}
                >
                  {fortified ? (
                    <Shield size={18} />
                  ) : tile === view.bonusTile ? (
                    <Zap size={18} />
                  ) : owner ? (
                    <span />
                  ) : (
                    ""
                  )}
                </button>
              );
            })}
          </div>
        )}
        {view.discipline === "mind" && puzzle && (
          <div className="mind-field">
            <span className="eyebrow">
              {player.solved
                ? "SOLVED · WAITING FOR RIVAL"
                : now < puzzle.revealUntil
                  ? puzzle.kind === "memory"
                    ? "WATCH THE SEQUENCE"
                    : "NEXT CHALLENGE"
                  : puzzle.kind === "memory"
                    ? "YOUR TURN · REPEAT IN ORDER"
                    : "CHOOSE YOUR ANSWER"}
            </span>
            <h3>{puzzle.prompt}</h3>
            {puzzle.kind === "memory" ? (
              <>
                <div className="memory-grid">
                  {Array.from({ length: 9 }, (_, tile) => {
                    const index = Math.floor(
                        (now -
                          (puzzle.revealUntil - puzzle.length * 650 - 500)) /
                          650,
                      ),
                      flashing =
                        puzzle.sequence[index] === tile &&
                        now < puzzle.revealUntil &&
                        (now -
                          (puzzle.revealUntil - puzzle.length * 650 - 500)) %
                          650 <
                          480;
                    return (
                      <button
                        key={tile}
                        aria-label={`Memory tile ${tile + 1}`}
                        className={flashing ? "lit" : ""}
                        disabled={now < puzzle.revealUntil || player.solved}
                        onClick={() => send({ tile })}
                      >
                        {tile + 1}
                      </button>
                    );
                  })}
                </div>
                <div className="memory-progress">
                  {Array.from({ length: puzzle.length }, (_, i) => (
                    <i
                      key={i}
                      className={i < player.progress ? "filled" : ""}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="logic-choices">
                {puzzle.choices.map((choice, i) => (
                  <button
                    key={i}
                    disabled={player.solved || now < puzzle.revealUntil}
                    onClick={() => send({ choice: i })}
                  >
                    <kbd>{i + 1}</kbd>
                    <b>{choice}</b>
                  </button>
                ))}
              </div>
            )}
            <div className="puzzle-timer">
              <span
                style={{
                  width: `${Math.max(0, ((puzzle.expiresAt - now) / 8500) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        <AnimatePresence>
          {view.transitionUntil > now && (
            <motion.div
              className="stage-transition"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="eyebrow">STAGE {view.stage} COMPLETE</span>
              <strong>Switch gears.</strong>
              <p>
                {view.totals[userId]} total points · Next challenge incoming
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        {view.discipline === "dodge" && !player.hp && (
          <div className="eliminated-note">
            You’re out. Waiting for the result…
          </div>
        )}
      </div>
      <div className="competition-controls">
        {view.discipline === "dodge" ? (
          <div className="direction-pad">
            {[
              ["a", ArrowLeft],
              ["w", ArrowUp],
              ["s", ArrowDown],
              ["d", ArrowRight],
            ].map(([key, Icon]) => {
              const Symbol = Icon as typeof ArrowLeft;
              return (
                <button
                  key={String(key)}
                  aria-label={`Move ${{ a: "left", w: "up", s: "down", d: "right" }[key as string]}`}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    pressed.current.add(String(key));
                    unlockSound();
                  }}
                  onPointerUp={() => pressed.current.delete(String(key))}
                  onPointerCancel={() => pressed.current.delete(String(key))}
                >
                  <Symbol size={19} />
                </button>
              );
            })}
          </div>
        ) : (
          <span className="small muted">
            {view.discipline === "grid"
              ? "Adjacent tiles only · ⚡ +60 / second"
              : view.discipline === "clash"
                ? "Gold = double points · × = decoy"
                : "Mistakes reset your streak"}
          </span>
        )}
        {view.discipline !== "mind" && (
          <button
            className="button ability-button"
            disabled={!abilityReady || view.transitionUntil > now}
            onClick={() => send({ ability: true })}
          >
            {view.discipline === "dodge" ? (
              <Zap size={16} />
            ) : view.discipline === "grid" ? (
              <Shield size={16} />
            ) : (
              <Crosshair size={16} />
            )}
            {now < player.readyAt
              ? `${Math.ceil((player.readyAt - now) / 1000)}s`
              : view.discipline === "dodge"
                ? "Dash"
                : view.discipline === "grid"
                  ? "Fortify · 3"
                  : "Focus · 3"}
            <kbd>SPACE</kbd>
          </button>
        )}
      </div>
      <div className="competition-notice" aria-live="polite">
        {view.notice}
      </div>
    </div>
  );
}

export function CompetitionPractice({
  game,
  onClose,
}: {
  game: Game;
  onClose: () => void;
}) {
  const [run, setRun] = useState(0),
    [state, setState] = useState<MatchState | null>(null);
  const engine = useRef<Competition | null>(null);
  useEffect(() => {
    const simulation = new Competition(game, ["you"], Date.now());
    engine.current = simulation;
    const publish = () => {
      simulation.tick(Date.now());
      const v = simulation.snapshot();
      setState({
        id: "practice",
        game,
        mode: "casual",
        phase: v.ended ? "finished" : "active",
        players: [],
        scores: simulation.scores(),
        answered: [],
        round: v.stage,
        rounds: v.stages,
        serverNow: Date.now(),
        startedAt: v.startedAt,
        deadline: v.stageEnds,
        challenge: { id: "practice" },
        feedback: {},
        winner: null,
        rematch: [],
        competition: v,
      });
    };
    publish();
    const timer = setInterval(publish, 50);
    return () => {
      clearInterval(timer);
      engine.current = null;
    };
  }, [game, run]);
  if (!state) return <p>Preparing training…</p>;
  return (
    <div className="competition-practice">
      <p className="muted small">
        Solo training · No opponent · No ranked points or rewards.
      </p>
      {state.phase === "finished" ? (
        <div className="practice-finished">
          <Trophy size={36} />
          <h2>{state.scores.you.toLocaleString()} points</h2>
          <p>{GAME_INFO[game].name} training complete.</p>
          <button className="button primary" onClick={onClose}>
            Back to arena
          </button>
          <button className="text-button" onClick={() => setRun((n) => n + 1)}>
            Train again
          </button>
        </div>
      ) : (
        <CompetitionField
          state={state}
          userId="you"
          onAction={(action) =>
            engine.current?.action("you", action, Date.now())
          }
          practice
        />
      )}
    </div>
  );
}
