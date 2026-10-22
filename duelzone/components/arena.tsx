"use client";
import { FrontierField, FrontierPractice, SeriesRecap } from "./frontier-field";
import { isFrontier } from "@/lib/frontier";
import { MatchIntro } from "./match-intro";
import { AnimatedNumber } from "./animated-number";
import { matchFeed } from "@/lib/match-feed";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Flag,
  RotateCcw,
  Target,
  Trophy,
  Zap,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  GAME_INFO,
  markerPosition,
  isCompetition,
  type MatchState,
  type Game,
} from "@/lib/shared";
import type { Action } from "@/server/game";
import { CompetitionField, CompetitionPractice } from "./competition-field";
import { ACHIEVEMENTS } from "@/lib/progression";
import { setSound, soundEnabled, tone, unlockSound } from "@/lib/sound";
const inkColors: Record<string, string> = {
  BLUE: "#a5bce9",
  CORAL: "#e8b39a",
  GREEN: "#c8f36a",
  PURPLE: "#c2b4df",
};

export function Playfield({
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
  const [time, setTime] = useState(Date.now());
  const offset = useRef(0);
  useEffect(() => {
    offset.current = state.serverNow - Date.now();
  }, [state.serverNow]);
  useEffect(() => {
    let frame: number;
    const loop = () => {
      setTime(Date.now() + offset.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  const done = state.answered.includes(userId);
  const active = state.phase === "active";
  const waiting = state.phase === "waiting";
  const feedback = state.feedback[userId];
  const submit = (extra: Partial<Action> = {}) => {
    if (state.challenge && !done)
      onAction({ challengeId: state.challenge.id, ...extra });
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector(".social-panel")) return;
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      if (
        (state.game === "reaction" || state.game === "precision") &&
        event.code === "Space"
      ) {
        event.preventDefault();
        submitRef.current();
      }
      if (state.game === "speed" && /^[1-4]$/.test(event.key))
        submitRef.current({ choice: Number(event.key) - 1 });
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [state.game]);
  const countdown = Math.max(0, Math.ceil((state.deadline - time) / 1000));
  return (
    <div
      className={`playfield ${state.game} ${active ? "is-active" : ""} ${done ? "answered" : ""}`}
    >
      <div className="field-top">
        <span>{practice ? "SOLO PRACTICE" : "LIVE DUEL"}</span>
        <span>
          ROUND {Math.max(1, state.round)} / {state.rounds}
        </span>
        <span>
          {active
            ? `${Math.max(0, (state.deadline - time) / 1000).toFixed(1)}s`
            : GAME_INFO[state.game].keys}
        </span>
      </div>
      {state.phase === "intro" ? (
        <div className="field-center intro">
          <span className="eyebrow">GET READY</span>
          <strong>{countdown || "GO"}</strong>
          <p>{GAME_INFO[state.game].description}</p>
        </div>
      ) : (
        <>
          {state.game === "reaction" && (
            <button
              aria-label={active ? "React now" : "Wait for green"}
              className={`reaction-surface ${active && !done ? "go" : ""}`}
              onPointerDown={() => submit()}
            >
              <Zap size={48} />
              <strong>
                {done
                  ? feedback?.detail
                  : active
                    ? "NOW."
                    : waiting
                      ? "Wait for green."
                      : "Round complete"}
              </strong>
              <span>
                {done
                  ? `+${feedback?.points || 0} points`
                  : active
                    ? "SPACE OR TAP"
                    : "Stay sharp. Don’t jump the signal."}
              </span>
            </button>
          )}
          {state.game === "aim" && (
            <div
              className="aim-surface"
              onPointerDown={(e) => {
                if (!active || done) return;
                const rect = e.currentTarget.getBoundingClientRect();
                submit({
                  x: (e.clientX - rect.left) / rect.width,
                  y: (e.clientY - rect.top) / rect.height,
                });
              }}
            >
              {active && !done ? (
                <>
                  <span className="target-coordinate">ACQUIRE TARGET</span>
                  <button
                    className="live-target"
                    aria-label="Hit target"
                    style={{
                      left: `${state.challenge!.x! * 100}%`,
                      top: `${state.challenge!.y! * 100}%`,
                    }}
                  >
                    <span />
                  </button>
                </>
              ) : (
                <div className="field-center">
                  <Target size={40} />
                  <strong>
                    {done ? feedback?.detail : "Find your focus."}
                  </strong>
                  <span>
                    {done
                      ? `+${feedback?.points || 0} points`
                      : "Target incoming"}
                  </span>
                </div>
              )}
            </div>
          )}
          {state.game === "speed" && (
            <div className="speed-surface">
              {active && !done ? (
                <>
                  <span className="eyebrow">SELECT THE INK COLOR</span>
                  <strong
                    className="stroop-word"
                    style={{ color: inkColors[state.challenge!.ink!] }}
                  >
                    {state.challenge!.word}
                  </strong>
                  <div className="color-choices">
                    {state.challenge!.choices!.map((color, i) => (
                      <button onClick={() => submit({ choice: i })} key={color}>
                        <span style={{ background: inkColors[color] }} />
                        <b>{color}</b>
                        <kbd>{i + 1}</kbd>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="field-center">
                  <strong>
                    {done ? feedback?.detail : "Clear your mind."}
                  </strong>
                  <span>
                    {done
                      ? `+${feedback?.points || 0} points`
                      : "Read the color, not the word."}
                  </span>
                </div>
              )}
            </div>
          )}
          {state.game === "precision" && (
            <button
              className="precision-surface"
              onPointerDown={() => {
                if (active) submit();
              }}
              aria-label="Stop the marker"
            >
              <span className="eyebrow">
                {done ? feedback?.detail : "STOP IN THE CENTER"}
              </span>
              <div className="precision-track">
                <div className="sweet-spot" />
                <span className="track-center" />
                <span
                  className="moving-needle"
                  style={{
                    left: `${done || !active ? 50 : markerPosition(time - state.startedAt, state.challenge?.period) * 100}%`,
                  }}
                />
              </div>
              <strong>
                {done
                  ? `+${feedback?.points || 0}`
                  : active
                    ? "Make it count."
                    : "Steady."}
              </strong>
              <span>{done ? "points" : "SPACE OR TAP TO STOP"}</span>
            </button>
          )}
        </>
      )}
      <div className="field-bottom">
        <span>
          <i className="status-dot" />
          {done ? "ANSWER LOCKED" : "TRUST YOUR SKILL"}
        </span>
        <span>
          {practice
            ? "Practice · not ranked"
            : "Server-scored · one attempt per round"}
        </span>
      </div>
    </div>
  );
}

function Arena({
  state,
  userId,
  onAction,
  onLeave,
  onRematch,
  onClose,
  connected,
}: {
  state: MatchState;
  userId: string;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onRematch: () => void;
  onClose: () => void;
  connected: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [audio, setAudio] = useState(true);
  const announced = useRef("");
  useEffect(() => setAudio(soundEnabled()), []);
  useEffect(() => {
    if (state.phase === "finished" && announced.current !== state.id) {
      announced.current = state.id;
      tone(state.winner === userId ? "win" : "loss");
    }
  }, [state.phase, state.id, state.winner, userId]);
  const arenaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    arenaRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  const finished = state.phase === "finished";
  const won = state.winner === userId;
  const tie = state.winner === null;
  return (
    <div
      className="arena-overlay"
      ref={arenaRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={
        state.mode === "ai" ? "AI practice match" : "Live multiplayer match"
      }
    >
      <div className="arena-wrap">
        <header className="arena-header">
          <div className="wordmark">
            <span className="brand-symbol">◩</span>DUELZONE
            <span className="divider" />
            <span className="muted">{GAME_INFO[state.game].name}</span>
          </div>
          <span className="mode-chip">
            {state.mode === "ai" ? "AI PRACTICE · BOT" : state.mode}
          </span>
          <button
            className="icon-button sound-toggle"
            aria-label={audio ? "Mute sound" : "Enable sound"}
            aria-pressed={audio}
            onClick={() => {
              setSound(!audio);
              setAudio(!audio);
              unlockSound();
            }}
          >
            {audio ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          {finished ? (
            <button className="text-button" onClick={onClose}>
              Back to arena <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="text-button muted"
              onClick={() => setConfirm(true)}
            >
              <Flag size={15} />
              Leave match
            </button>
          )}
        </header>
        {!connected && !finished && (
          <div className="connection-warning">
            Connection lost. Reconnecting… You have 20 seconds before a forfeit.
          </div>
        )}
        {confirm && !finished && (
          <div className="leave-confirm">
            <p>Leaving gives your opponent the win.</p>
            <button
              className="button danger"
              onClick={() => {
                onLeave();
                setConfirm(false);
              }}
            >
              Forfeit match
            </button>
            <button
              className="button secondary"
              onClick={() => setConfirm(false)}
            >
              Keep playing
            </button>
          </div>
        )}
        <div className="scoreboard">
          {state.players.map((p, i) => (
            <div
              className={`score-player ${p.id === userId ? "self" : ""}`}
              key={p.id}
            >
              <div
                className="avatar"
                style={{ color: p.accent, background: `${p.accent}15` }}
              >
                {p.username.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <span className="eyebrow">
                  {p.bot
                    ? "AI OPPONENT · BOT"
                    : p.id === userId
                      ? "YOU"
                      : "OPPONENT"}
                </span>
                <h2>{p.username}</h2>
              </div>
              <strong>
                <AnimatedNumber
                  value={
                    state.game === "showdown"
                      ? state.scores[p.id] / 2
                      : state.scores[p.id]
                  }
                />
              </strong>
              {i === 0 && <div className="versus">VS</div>}
            </div>
          ))}
        </div>
        <AnimatePresence mode="wait">
          {finished ? (
            <motion.div
              className={`match-results ${won ? "victory" : tie ? "draw" : "defeat"}`}
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className={`result-emblem ${won ? "won" : ""}`}>
                <Trophy size={48} strokeWidth={1} />
              </div>
              {won && (
                <div className="victory-lines" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, i) => (
                    <i
                      key={i}
                      style={{ "--line-index": i } as React.CSSProperties}
                    />
                  ))}
                </div>
              )}
              <span className="eyebrow">
                {state.reason === "Score" ? "MATCH COMPLETE" : state.reason}
              </span>
              <h1>
                {tie
                  ? "Perfectly matched."
                  : won
                    ? "That’s your win."
                    : "The next one is yours."}
              </h1>
              <p>
                {tie
                  ? "Even on points. Settle it with a rematch."
                  : won
                    ? "Small margins. A well-earned victory."
                    : "Every match is a chance to find your edge."}
              </p>
              {state.mode === "ranked" && (
                <div className="rating-result">
                  {(state.changes?.[userId] || 0) >= 0 ? "+" : ""}
                  {state.changes?.[userId] || 0}
                  <span>RATING POINTS</span>
                </div>
              )}
              {state.rewards?.[userId] && (
                <div className="earned-rewards">
                  <strong>+{state.rewards[userId].xp} XP</strong>
                  {state.rewards[userId].daily.length > 0 && (
                    <span>
                      {state.rewards[userId].daily.length} daily challenge
                      {state.rewards[userId].daily.length > 1 ? "s" : ""}{" "}
                      completed
                    </span>
                  )}
                  {state.rewards[userId].achievements.map((id) => (
                    <span className="achievement-earned" key={id}>
                      <Trophy size={14} />
                      {ACHIEVEMENTS.find((a) => a.id === id)?.name}
                    </span>
                  ))}
                </div>
              )}
              {state.frontier && (
                <SeriesRecap view={state.frontier} players={state.players} />
              )}
              <div className="result-actions">
                {state.mode !== "tournament" && (
                  <button
                    className="button primary"
                    disabled={state.rematch.includes(userId)}
                    onClick={onRematch}
                  >
                    <RotateCcw size={16} />
                    {state.rematch.includes(userId)
                      ? "Waiting for opponent…"
                      : state.rematch.length
                        ? "Accept rematch"
                        : "Run it back"}
                  </button>
                )}
                <button className="button secondary" onClick={onClose}>
                  Back to arena
                  <ArrowRight size={16} />
                </button>
              </div>
              {state.mode === "tournament" && won && (
                <p className="small muted">
                  Your next bracket match starts automatically when ready.
                </p>
              )}
              <div className="saved-note">
                <Check size={14} />
                {state.mode === "ai"
                  ? "AI practice · no ranked points or profile rewards"
                  : "Result saved to your profile"}
              </div>
            </motion.div>
          ) : state.phase === "intro" ? (
            <MatchIntro key={state.id} state={state} userId={userId} />
          ) : (
            <motion.div
              key="field"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {state.frontier ? (
                <FrontierField
                  state={state}
                  userId={userId}
                  onAction={onAction}
                />
              ) : state.competition ? (
                <CompetitionField
                  state={state}
                  userId={userId}
                  onAction={onAction}
                />
              ) : (
                <Playfield
                  state={state}
                  userId={userId}
                  onAction={(action) => {
                    unlockSound();
                    onAction(action);
                  }}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="round-summary">
          {state.players.map((p) => (
            <div key={p.id}>
              <span>{p.username}</span>
              <span>{state.feedback[p.id]?.detail || "—"}</span>
              <strong>
                {state.feedback[p.id] ? `+${state.feedback[p.id].points}` : ""}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Practice(props: { game: Game; onClose: () => void }) {
  return isFrontier(props.game) ? (
    <FrontierPractice {...props} />
  ) : isCompetition(props.game) ? (
    <CompetitionPractice {...props} />
  ) : (
    <ClassicPractice {...props} />
  );
}
function ClassicPractice({
  game,
  onClose,
}: {
  game: Game;
  onClose: () => void;
}) {
  const [state, setState] = useState<MatchState>(() => ({
    id: "practice",
    game,
    mode: "casual",
    phase: "intro",
    players: [],
    scores: { you: 0 },
    answered: [],
    round: 0,
    rounds: 3,
    serverNow: Date.now(),
    startedAt: Date.now(),
    deadline: Date.now() + 1500,
    challenge: null,
    feedback: {},
    winner: null,
    rematch: [],
  }));
  const latest = useRef(state);
  latest.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const initial: MatchState = {
      id: "practice",
      game,
      mode: "casual",
      phase: "intro",
      players: [],
      scores: { you: 0 },
      answered: [],
      round: 0,
      rounds: 3,
      serverNow: Date.now(),
      startedAt: Date.now(),
      deadline: Date.now() + 1500,
      challenge: null,
      feedback: {},
      winner: null,
      rematch: [],
    };
    setState(initial);
    latest.current = initial;
    function begin() {
      setState((s) => ({
        ...s,
        phase: "waiting",
        round: s.round + 1,
        answered: [],
        feedback: {},
        challenge: { id: crypto.randomUUID() },
        serverNow: Date.now(),
        deadline: 0,
      }));
      timer.current = setTimeout(
        () => {
          const now = Date.now();
          setState((s) => ({
            ...s,
            phase: "active",
            serverNow: now,
            startedAt: now,
            deadline: now + 3500,
            challenge: {
              ...s.challenge!,
              x: 0.18 + Math.random() * 0.64,
              y: 0.2 + Math.random() * 0.6,
              choices: ["BLUE", "CORAL", "GREEN", "PURPLE"],
              word: ["BLUE", "CORAL", "GREEN", "PURPLE"][
                Math.floor(Math.random() * 4)
              ],
              ink: ["BLUE", "CORAL", "GREEN", "PURPLE"][
                Math.floor(Math.random() * 4)
              ],
              period: 1800,
            },
          }));
          timer.current = setTimeout(
            () => finishRound(0, "Time expired"),
            3500,
          );
        },
        game === "reaction" ? 1200 + Math.random() * 1800 : 500,
      );
    }
    function finishRound(points: number, detail: string) {
      if (timer.current) clearTimeout(timer.current);
      setState((s) => ({
        ...s,
        phase: "review",
        answered: ["you"],
        feedback: { you: { points, detail } },
        scores: { you: s.scores.you + points },
        serverNow: Date.now(),
      }));
      timer.current = setTimeout(() => {
        if (latest.current.round >= 3)
          setState((s) => ({ ...s, phase: "finished" }));
        else begin();
      }, 1000);
    }
    finishRef.current = finishRound;
    timer.current = setTimeout(begin, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [game, run]);
  const finishRef = useRef<(points: number, detail: string) => void>(() => {});
  const locked = useRef("");
  const action = (a: Action) => {
    const s = latest.current;
    if (
      s.answered.includes("you") ||
      locked.current === s.challenge?.id ||
      !(s.phase === "active" || (s.phase === "waiting" && game === "reaction"))
    )
      return;
    locked.current = s.challenge!.id;
    const elapsed = Date.now() - s.startedAt;
    let points = 0,
      detail = "";
    if (s.phase === "waiting") detail = "False start — wait for green";
    else if (game === "reaction") {
      points = Math.max(0, Math.round(1000 - elapsed * 1.2));
      detail = `${elapsed} ms`;
    } else if (game === "aim") {
      const d = Math.hypot(a.x! - s.challenge!.x!, a.y! - s.challenge!.y!);
      points =
        d > 0.065
          ? 0
          : Math.round(
              650 * (1 - d / 0.065) + 350 * Math.max(0, 1 - elapsed / 2500),
            );
      detail =
        d > 0.065 ? "Miss" : `${Math.round((1 - d / 0.065) * 100)}% accuracy`;
    } else if (game === "speed") {
      const correct = s.challenge!.choices![a.choice!] === s.challenge!.ink;
      points = correct ? Math.max(100, Math.round(1000 - elapsed * 0.3)) : 0;
      detail = correct ? "Correct" : "Wrong color";
    } else {
      const accuracy = Math.max(
        0,
        1 - Math.abs(markerPosition(elapsed, 1800) - 0.5) * 2,
      );
      points = Math.round(1000 * accuracy ** 3);
      detail = `${Math.round(accuracy * 100)}% precision`;
    }
    finishRef.current(points, detail);
  };
  return (
    <div className="practice-wrap">
      <p className="muted small">
        A solo warm-up. Multiplayer matches are against real players.
      </p>
      {state.phase === "finished" ? (
        <div className="practice-finished">
          <Trophy size={36} />
          <h2>{state.scores.you.toLocaleString()} points</h2>
          <p>Warm-up complete. Ready for a real opponent?</p>
          <button className="button primary" onClick={onClose}>
            Back to arena
            <ArrowRight size={16} />
          </button>
          <button className="text-button" onClick={() => setRun((r) => r + 1)}>
            Practice again
          </button>
        </div>
      ) : (
        <Playfield state={state} userId="you" onAction={action} practice />
      )}
    </div>
  );
}

export default function LiveArena(props: React.ComponentProps<typeof Arena>) {
  const live = useSyncExternalStore(
    matchFeed.subscribe,
    matchFeed.get,
    () => null,
  );
  return (
    <Arena
      {...props}
      state={live?.id === props.state.id ? live : props.state}
    />
  );
}
