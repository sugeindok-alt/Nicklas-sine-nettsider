"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, MessageSquare, Trophy } from "lucide-react";
import { api } from "@/lib/client";
import { GAME_INFO, type MatchState, type Game } from "@/lib/shared";
import Modal from "./modal";
export function FeedbackButton({ match }: { match?: MatchState }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState("");
  const rate =
    match &&
    match.mode !== "ai" &&
    match.mode !== "ghost" &&
    match.phase === "finished";
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/feedback", {
        kind: form.get("kind"),
        body: form.get("body"),
        steps: form.get("steps"),
        ...(match ? { game: match.game } : {}),
        ...(rate
          ? { matchId: match.id, rating: Number(form.get("rating")) }
          : {}),
      });
      setReceipt(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="text-button" onClick={() => setOpen(true)}>
        <MessageSquare size={15} />
        Give feedback
      </button>
      {open && (
        <Modal
          title="Help shape the next match."
          onClose={() => setOpen(false)}
        >
          {receipt ? (
            <div className="empty-state">
              <Check size={28} />
              <h3>Feedback saved.</h3>
              <p>Your report is in the owner’s review queue.</p>
              <small className="muted">Reference {receipt.slice(0, 8)}</small>
              <button
                className="button secondary"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          ) : (
            <form className="form-stack" onSubmit={send}>
              <p className="modal-description">
                Tell us what happened and what would make it better. Up to five
                reports per day. For player conduct, use Report in Friends.
              </p>
              <label>
                Feedback type
                <select name="kind">
                  <option value="bug">Report a bug</option>
                  <option value="idea">Suggest an improvement</option>
                  {rate && <option value="rating">Rate this game</option>}
                </select>
              </label>
              {rate && (
                <label>
                  Game rating
                  <select name="rating" defaultValue="3">
                    <option value="1">1 / 5</option>
                    <option value="2">2 / 5</option>
                    <option value="3">3 / 5</option>
                    <option value="4">4 / 5</option>
                    <option value="5">5 / 5</option>
                  </select>
                </label>
              )}
              <label>
                What should we know?
                <textarea
                  name="body"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={4}
                  placeholder="What happened, or what would you like to improve?"
                />
              </label>
              <label>
                Steps to reproduce (optional)
                <textarea
                  name="steps"
                  maxLength={2000}
                  rows={3}
                  placeholder="Game, device, actions and what you expected…"
                />
              </label>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Send feedback"}
                <ArrowUpRight size={16} />
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
type ActivityEvent = {
  id: string;
  kind: string;
  game: Game | null;
  score: number;
  created_at: string;
  user_id: string;
  username: string;
  accent: string;
};
export function FriendsActivity({
  revision,
  onProfile,
}: {
  revision: number;
  onProfile: (id: string) => void;
}) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      void api<{ events: ActivityEvent[] }>("/activity")
        .then((r) => {
          if (live) {
            setEvents(r.events);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [revision]);
  return (
    <section className="panel friends-activity">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR CIRCLE</span>
          <h2>From the arena.</h2>
        </div>
        <button
          className="text-button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("dz:friends", { detail: { tab: "privacy" } }),
            )
          }
        >
          Sharing preferences
          <ArrowUpRight size={14} />
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : events === null ? (
        <p className="muted">Loading activity…</p>
      ) : events.length ? (
        events.slice(0, 6).map((e) => (
          <div className="activity-row" key={e.id}>
            <Trophy size={17} style={{ color: e.accent }} />
            <div>
              <button
                className="text-button"
                onClick={() => onProfile(e.user_id)}
              >
                {e.username}
              </button>
              <span>
                {e.kind === "daily"
                  ? "completed the daily circuit"
                  : e.kind === "tournament"
                    ? "won a tournament"
                    : e.kind === "record"
                      ? `set a personal best in ${GAME_INFO[e.game!].name}`
                      : `won ${GAME_INFO[e.game!].name}`}
              </span>
            </div>
            <small>
              {new Date(e.created_at).toLocaleDateString([], {
                month: "short",
                day: "numeric",
              })}
            </small>
          </div>
        ))
      ) : (
        <p className="activity-empty">
          Your friends’ shared wins, records and daily circuits will appear
          here. Sharing is optional and off by default.
        </p>
      )}
    </section>
  );
}
export function UpdateHistory() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-button" onClick={() => setOpen(true)}>
        What’s new
        <ArrowUpRight size={14} />
      </button>
      {open && (
        <Modal
          title="Always another level."
          wide
          onClose={() => setOpen(false)}
        >
          <div className="changelog-entry">
            <span className="eyebrow">
              27 OCTOBER 2026 / PLATFORM EVOLUTION
            </span>
            <h2>A daily reason to compete.</h2>
            <ul>
              <li>
                Daily Duel: the same 30-second circuit for everyone,
                server-scored attempts and a persistent daily board.
              </li>
              <li>
                Ranked Showdown Draft: bans, preferences and a synchronized
                best-of-three. Casual random Showdown remains available.
              </li>
              <li>
                Private eight-person lobbies with two player seats, spectator
                seats, host controls and room chat.
              </li>
              <li>
                Game mastery, earned specialist nameplates and saved training
                sessions across all fifteen AI disciplines.
              </li>
              <li>
                Private or public four- and eight-player tournaments with ready
                checks and automatic brackets.
              </li>
              <li>
                Optional friend activity sharing, in-game feedback and measured
                performance information.
              </li>
              <li>
                Server-recorded physics replays with timeline controls, real
                goal/comeback moments and private sharing. Grapple ghosts
                reproduce recorded runs on the same course.
              </li>
              <li>
                Less redundant game-state copying, bounded tournament queries
                and an installable app with an offline connection screen.
              </li>
            </ul>
            <h3>Current limits</h3>
            <p>
              Live play requires an internet connection. Free hosting can take
              time to wake and a server restart interrupts active matches. Touch
              and keyboard/mouse share queues. Replay and recorded moments
              support Knockout, Momentum Ball, Grapple Rush and Core Control;
              ghost races support Grapple only. Replay storage retains the
              newest 200 supported matches. Video export is not available.
            </p>
          </div>
          <div className="changelog-entry">
            <span className="eyebrow">22 OCTOBER 2026 / VISUAL IDENTITY</span>
            <h2>Built around the games.</h2>
            <p>
              Custom DuelZone branding, real gameplay previews, a refined game
              library and a consistent desktop and mobile interface.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
