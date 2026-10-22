"use client";
import { Check, Lock, Trophy } from "lucide-react";
import {
  ACHIEVEMENTS,
  rarity,
  type Progression as Progress,
} from "@/lib/progression";
export function ProgressionPanel({
  progress,
  compact = false,
}: {
  progress: Progress;
  compact?: boolean;
}) {
  return (
    <section
      className={`progression-panel ${compact ? "compact" : ""}`}
      aria-label="Player progression"
    >
      <div className="progression-heading">
        <div>
          <span className="eyebrow">YOUR NEXT MILESTONE</span>
          <h2>
            Level {progress.level} <span>{progress.title}</span>
          </h2>
        </div>
        <strong>
          {progress.xp.toLocaleString()} <small>XP</small>
        </strong>
      </div>
      <div
        className="xp-track"
        role="progressbar"
        aria-label="Experience to next level"
        aria-valuemin={0}
        aria-valuemax={500}
        aria-valuenow={progress.levelXp}
      >
        <span style={{ width: `${progress.levelXp / 5}%` }} />
      </div>
      <div className="xp-caption">
        <span>
          {progress.levelXp} / 500 XP to level {progress.level + 1}
        </span>
        <span>Cosmetic rewards. Equal competition.</span>
      </div>
      <div className="daily-heading">
        <h3>Daily challenges</h3>
        <span>Reset 00:00 UTC · +75 XP each</span>
      </div>
      <div className="daily-grid">
        {progress.daily.map((goal) => (
          <div
            key={goal.id}
            className={`daily-goal ${goal.complete ? "complete" : ""}`}
          >
            <span>
              {goal.complete ? (
                <Check size={18} />
              ) : (
                <span className="goal-dot" />
              )}
            </span>
            <div>
              <b>{goal.name}</b>
              <p>{goal.description}</p>
            </div>
            <small>{goal.complete ? "DONE" : "+75"}</small>
          </div>
        ))}
      </div>
      {progress.weekly && (
        <>
          <div className="daily-heading">
            <h3>Weekly challenges</h3>
            <span>Reset Monday · +150 XP each</span>
          </div>
          <div className="daily-grid">
            {progress.weekly.map((g) => (
              <div
                key={g.id}
                className={`daily-goal ${g.complete ? "complete" : ""}`}
              >
                <span>
                  {g.complete ? (
                    <Check size={18} />
                  ) : (
                    <span className="goal-dot" />
                  )}
                </span>
                <div>
                  <b>{g.name}</b>
                  <p>{g.description}</p>
                  <small>
                    {g.progress}/{g.target} completed
                  </small>
                </div>
                <small>{g.complete ? "DONE" : "+150"}</small>
              </div>
            ))}
          </div>
        </>
      )}
      {!compact && (
        <>
          <div className="daily-heading">
            <h3>Achievements & titles</h3>
            <span>
              {progress.achievements.length} / {ACHIEVEMENTS.length} earned
            </span>
          </div>
          <div className="achievement-grid">
            {ACHIEVEMENTS.map((a) => {
              const earned = progress.achievements.find(
                (item) => item.id === a.id,
              );
              return (
                <div
                  key={a.id}
                  className={`achievement-tile ${earned ? "earned" : ""}`}
                >
                  {earned ? <Trophy size={20} /> : <Lock size={18} />}
                  <div>
                    <b>{a.name}</b>
                    <span className="achievement-rarity">{rarity[a.id]}</span>
                    <p>{a.description}</p>
                    <small>
                      {earned
                        ? `${a.title} · Earned ${new Date(earned.earned_at).toLocaleDateString()}`
                        : `Unlocks “${a.title}” title`}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="small muted reward-note">
        Match XP for your first five completed duels each day (
        {progress.rewardedMatches}/5). Achievements reward skill, not a daily
        streak. Practice and forfeits give no XP.
      </p>
    </section>
  );
}
