"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { GAME_INFO, type Player, type Game } from "@/lib/shared";
import { gameIcons } from "./game-art";
export type Mastery = {
  game: Game;
  xp: number;
  played: number;
  wins: number;
  best: number;
};
export function MasteryPanel({ rows }: { rows: Mastery[] }) {
  return (
    <section className="panel mastery-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">A DISCIPLINE OF YOUR OWN</span>
          <h2>Game mastery.</h2>
        </div>
        <span className="small muted">Earned in real matches</span>
      </div>
      {rows.length ? (
        <div className="mastery-grid">
          {rows.map((row) => {
            const Icon = gameIcons[row.game],
              level = Math.floor(row.xp / 125) + 1;
            return (
              <div className="mastery-item" key={row.game}>
                <Icon size={24} style={{ color: GAME_INFO[row.game].color }} />
                <div>
                  <div className="mastery-title">
                    <b>{GAME_INFO[row.game].name}</b>
                    <span>LV {level}</span>
                  </div>
                  <div
                    className="mastery-track"
                    aria-label={`${row.xp % 125} of 125 XP to next level`}
                  >
                    <i
                      style={{
                        width: `${((row.xp % 125) / 125) * 100}%`,
                        background: GAME_INFO[row.game].color,
                      }}
                    />
                  </div>
                  <small>
                    {row.played} matches · {row.wins} wins · best{" "}
                    {(row.game === "showdown"
                      ? row.best / 2
                      : row.best
                    ).toLocaleString()}
                  </small>
                  <small>
                    {row.xp} mastery XP
                    {level >= 5
                      ? " · Specialist nameplate unlocked"
                      : " · Specialist nameplate at level 5"}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          Finish a multiplayer match to begin your first discipline.
        </p>
      )}
      <p className="small muted mastery-note">
        35 XP for a completed scoring match, plus 15 for a win. Up to five
        rewarded matches per game each UTC day, and two against the same rival.
        Forfeits, zero-score runs and AI practice do not earn mastery.
        Historical matches remain in your records; mastery XP begins with this
        update.
      </p>
    </section>
  );
}

export function MasteryWorkshop({
  user,
  rows,
  onSave,
}: {
  user: Player;
  rows: Mastery[];
  onSave: (p: Player) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function equip(game: Game | "") {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ player: Player }>("/profile/mastery", { game });
      onSave(r.player);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mastery-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">EARNED, NEVER BOUGHT</span>
          <h2>Specialist nameplates.</h2>
        </div>
      </div>
      <p className="muted small">
        Reach mastery level 5 to wear a discipline on your profile. Cosmetics
        never change gameplay.
      </p>
      <div className="training-options">
        <button
          className={`button ${!user.mastery_badge ? "primary" : "secondary"} compact`}
          disabled={busy}
          onClick={() => void equip("")}
        >
          No nameplate
        </button>
        {rows.map((r) => (
          <button
            className={`button ${user.mastery_badge === r.game ? "primary" : "secondary"} compact`}
            key={r.game}
            disabled={busy || r.xp < 500}
            onClick={() => void equip(r.game)}
          >
            {GAME_INFO[r.game].short} specialist
            {r.xp < 500
              ? ` · ${r.xp}/500 XP`
              : user.mastery_badge === r.game
                ? " ✓"
                : ""}
          </button>
        ))}
      </div>
      {!rows.length && (
        <p className="muted small">
          Your first scored multiplayer match starts your collection.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
