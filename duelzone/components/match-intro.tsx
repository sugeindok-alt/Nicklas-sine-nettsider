"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { GAME_INFO, type MatchState } from "@/lib/shared";
export function MatchIntro({
  state,
  userId,
}: {
  state: MatchState;
  userId: string;
}) {
  const [time, setTime] = useState(Date.now());
  const [deadline] = useState(
    () => Date.now() + Math.max(0, state.deadline - state.serverNow),
  );
  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(1, Math.ceil((deadline - time) / 1000));
  return (
    <motion.div
      className="match-intro"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
    >
      <span className="eyebrow">
        {state.mode === "ai" ? "AI PRACTICE READY" : "OPPONENT FOUND"}
      </span>
      <div className="intro-players">
        {state.players.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, x: i ? 35 : -35 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: i * 0.12 }}
          >
            <div
              className="intro-avatar"
              style={{ color: p.accent, borderColor: `${p.accent}55` }}
            >
              {p.bot ? "AI" : p.username.slice(0, 2).toUpperCase()}
            </div>
            <strong>{p.username}</strong>
            <small>
              {p.bot
                ? "BOT · " + p.difficulty
                : p.id === userId
                  ? "YOU"
                  : "YOUR OPPONENT"}
            </small>
            {i === 0 && <span className="intro-vs">VS</span>}
          </motion.div>
        ))}
      </div>
      <h2>{GAME_INFO[state.game].name}</h2>
      <p>{GAME_INFO[state.game].keys}</p>
      <motion.div
        className="intro-count"
        key={seconds}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        {seconds}
      </motion.div>
      <div className="intro-timeline">
        <i />
      </div>
    </motion.div>
  );
}
