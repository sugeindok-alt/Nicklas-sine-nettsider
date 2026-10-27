"use client";
import { useEffect, useState } from "react";
import { Check, Timer } from "lucide-react";
import { draftGames, type DraftState } from "@/lib/draft";
import { GAME_INFO } from "@/lib/shared";
import type { Sport } from "@/lib/frontier";
import { gameIcons } from "./game-art";
import type { Command } from "./platform-center";
import Modal from "./modal";
export function ShowdownDraft({
  state,
  userId,
  command,
}: {
  state: DraftState;
  userId: string;
  command: Command;
}) {
  const [seconds, setSeconds] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const at = performance.now();
    const update = () =>
      setSeconds(
        Math.max(
          0,
          Math.ceil(
            (state.deadline - state.serverNow - (performance.now() - at)) /
              1000,
          ),
        ),
      );
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [state.deadline, state.serverNow]);
  const mine = state.choices[userId];
  async function choose(
    ban: Sport | null,
    preferred: Sport | null,
    ready: boolean,
  ) {
    setBusy(true);
    setError("");
    try {
      await command("draft:choose", { id: state.id, ban, preferred, ready });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Build your Showdown."
      wide
      onClose={() => {
        void command("draft:cancel").catch((e) => setError(e.message));
      }}
    >
      <div className="daily-heading">
        <span className="eyebrow">
          BEST OF THREE /{" "}
          {state.phase === "choices" ? "PICK & BAN" : "FINAL SELECTION"}
        </span>
        <span className="daily-reset">
          <Timer size={14} />
          {Number.isFinite(seconds) ? `${seconds}s` : "Starting…"}
        </span>
      </div>
      <p className="draft-summary">
        {state.phase === "choices"
          ? "Ban one discipline and favour another. Shared preferences lead the order; ties use a fair shuffled order. Unanswered bans are selected automatically when time runs out."
          : "These are your three disciplines. First to two wins takes the series; tied rounds split a point. Confirm now, or the series starts when the timer ends."}
      </p>
      <div className="draft-players">
        {state.players.map((p) => (
          <span key={p.id} style={{ color: p.accent }}>
            {p.username}
            {p.id === userId ? " · You" : ""}{" "}
            {state.choices[p.id].ready && <Check size={14} />}
            <small className="muted">
              {state.choices[p.id].ban
                ? ` / Banned ${GAME_INFO[state.choices[p.id].ban!].short}`
                : " / Choosing"}
            </small>
          </span>
        ))}
      </div>
      <div className="draft-pool">
        {draftGames.map((g) => {
          const Icon = gameIcons[g],
            banned = Object.values(state.choices).some((c) => c.ban === g),
            selected = state.selection.includes(g);
          return (
            <div
              key={g}
              className={`draft-card ${banned ? "banned" : ""} ${selected ? "chosen" : ""}`}
            >
              <Icon size={30} style={{ color: GAME_INFO[g].color }} />
              <h3>{GAME_INFO[g].name}</h3>
              {state.phase === "choices" ? (
                <>
                  <button
                    className="text-button"
                    disabled={busy || mine.ready}
                    onClick={() =>
                      void choose(
                        mine.ban === g ? null : g,
                        mine.preferred === g ? null : mine.preferred,
                        false,
                      )
                    }
                  >
                    {mine.ban === g ? "Undo ban" : "Ban"}
                  </button>
                  <button
                    className={`text-button ${mine.preferred === g ? "draft-prefer" : ""}`}
                    disabled={busy || mine.ready}
                    onClick={() =>
                      void choose(
                        mine.ban === g ? null : mine.ban,
                        mine.preferred === g ? null : g,
                        false,
                      )
                    }
                  >
                    {mine.preferred === g ? "Preferred ✓" : "Prefer"}
                  </button>
                </>
              ) : (
                <span className="small muted">
                  {selected
                    ? `ROUND ${state.selection.indexOf(g) + 1}`
                    : "Out of pool"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="draft-actions">
        <button
          className="text-button"
          disabled={state.phase === "starting"}
          onClick={() =>
            void command("draft:cancel").catch((e) => setError(e.message))
          }
        >
          Leave draft
        </button>
        <button
          className="button primary"
          disabled={busy || state.phase === "starting"}
          onClick={() => void choose(mine.ban, mine.preferred, !mine.ready)}
        >
          {state.phase === "starting"
            ? "Starting series…"
            : mine.ready
              ? "Change selection"
              : state.phase === "choices"
                ? "Lock selections"
                : "Confirm series"}
          <Check size={16} />
        </button>
      </div>
    </Modal>
  );
}
