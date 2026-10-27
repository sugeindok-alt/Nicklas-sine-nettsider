"use client";
import { useState, useEffect } from "react";
import {
  Users,
  UserPlus,
  Check,
  Swords,
  ArrowUpRight,
  LogOut,
  X,
} from "lucide-react";
import Modal from "./modal";
import { games, GAME_INFO, type Game, type Player } from "@/lib/shared";
import {
  defaultRules,
  watchableGames,
  type MatchRules,
  type SocialState,
} from "@/lib/social";
import type { PlatformState } from "@/lib/platform";
import { openFriends, type Command } from "./platform-center";
import type { Tournament } from "./duelzone";
export function PartyPanel({
  user,
  state,
  social,
  command,
  connected,
  matchId,
}: {
  user: Player;
  state: PlatformState | null;
  social: SocialState | null;
  command: Command;
  connected: boolean;
  matchId?: string;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [game, setGame] = useState<Game | "any">("any"),
    [rules, setRules] = useState<MatchRules>(defaultRules),
    [target, setTarget] = useState(""),
    [chat, setChat] = useState("");
  const party = state?.party,
    host = party?.host_id === user.id,
    mine = party?.members.find((m) => m.id === user.id),
    invites =
      state?.invitations.filter((i) => Date.parse(i.expires_at) > Date.now()) ||
      [];
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("dz:party", show);
    return () => window.removeEventListener("dz:party", show);
  }, []);
  useEffect(() => {
    setGame(party?.game || "any");
    setRules(party?.rules || defaultRules);
  }, [
    party?.id,
    party?.game,
    party?.rules.length,
    party?.rules.spectators,
    party?.rules.draft,
  ]);
  useEffect(() => {
    if (matchId) setOpen(false);
  }, [matchId]);
  async function act(event: string, data: unknown = {}) {
    setBusy(true);
    setError("");
    try {
      await command(event, data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="party-launcher text-button"
        onClick={() => setOpen(true)}
        aria-label="Open party"
      >
        <Users size={17} />
        <span>{party ? `${party.members.length}/8 lobby` : "Party"}</span>
        {invites.length > 0 && <b>{invites.length}</b>}
      </button>
      {open && (
        <Modal title="Better with a rival." onClose={() => setOpen(false)}>
          <div className="party-panel">
            <p className="muted small">
              Up to eight friends. Two active players, six spectator seats.
              Choose the rules, ready up and settle it in the arena.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!connected && (
              <p className="connection-warning">
                Reconnecting… Party actions resume when connected.
              </p>
            )}
            {invites.map((i) => (
              <div className="party-invite" key={i.id}>
                <UserPlus size={20} />
                <div>
                  <b>{i.sender} invited you.</b>
                  <small>
                    Expires{" "}
                    {new Date(i.expires_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
                <button
                  className="button primary compact"
                  disabled={busy || !connected}
                  onClick={() =>
                    void act("party:respond", { inviteId: i.id, accept: true })
                  }
                >
                  Join party
                </button>
                <button
                  className="icon-button"
                  aria-label={`Decline party from ${i.sender}`}
                  disabled={busy || !connected}
                  onClick={() =>
                    void act("party:respond", { inviteId: i.id, accept: false })
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            {!state ? (
              <p className="muted">Loading your party…</p>
            ) : !party ? (
              <div className="empty-state">
                <Users size={35} />
                <h3>Your private match starts here.</h3>
                <p>Create a party and invite an online friend.</p>
                <button
                  className="button primary"
                  disabled={busy || !connected}
                  onClick={() => void act("party:create")}
                >
                  Create party <ArrowUpRight size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="party-members">
                  {party.members.map((m) => (
                    <div key={m.id}>
                      <span className="avatar" style={{ color: m.accent }}>
                        {m.username.slice(0, 2)}
                      </span>
                      <span>
                        <b>
                          {m.username}{" "}
                          {m.id === party.host_id && <small>HOST</small>}
                        </b>
                        <small>
                          {m.online ? "Online" : "Offline / status private"}
                        </small>
                      </span>
                      {host ? (
                        <select
                          className="party-seat-select"
                          aria-label={`Seat for ${m.username}`}
                          value={m.role}
                          disabled={busy || !connected}
                          onChange={(e) =>
                            void act("party:seat", {
                              target: m.id,
                              role: e.target.value,
                            })
                          }
                        >
                          <option value="player">Player</option>
                          <option value="spectator">Spectator</option>
                        </select>
                      ) : (
                        <small className="party-role">{m.role}</small>
                      )}
                      <em className={m.ready ? "ready" : ""}>
                        {m.ready ? "Ready" : "Not ready"}
                      </em>
                      {host && m.id !== user.id && (
                        <button
                          className="icon-button"
                          aria-label={`Remove ${m.username} from party`}
                          disabled={busy}
                          onClick={() =>
                            void act("party:remove", { target: m.id })
                          }
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {party.members.length === 1 && (
                    <div className="party-empty-slot">
                      <UserPlus size={23} />
                      <span>Your rival’s seat is open.</span>
                    </div>
                  )}
                </div>
                {host && party.members.length < 8 && (
                  <form
                    className="party-invite-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act("party:invite", { target });
                    }}
                  >
                    <label className="sr-only" htmlFor="party-friend">
                      Friend to invite
                    </label>
                    <select
                      id="party-friend"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Choose a friend…</option>
                      {social?.friends
                        .filter(
                          (f) =>
                            (f.presence === "online" ||
                              f.presence === "away") &&
                            !party.members.some((m) => m.id === f.id),
                        )
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.username}
                          </option>
                        ))}
                    </select>
                    <button
                      className="button secondary compact"
                      disabled={busy || !target || !connected}
                    >
                      Invite
                    </button>
                  </form>
                )}
                <form
                  className="form-stack party-rules"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("party:configure", { game, rules });
                  }}
                >
                  <label>
                    Discipline
                    <select
                      aria-label="Party discipline"
                      disabled={!host || busy}
                      value={game}
                      onChange={(e) => {
                        setGame(e.target.value as Game | "any");
                        setRules((r) => ({ ...r, spectators: false }));
                      }}
                    >
                      <option value="any">Random discipline</option>
                      {games.map((g) => (
                        <option value={g} key={g}>
                          {GAME_INFO[g].name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Match length
                    <select
                      aria-label="Party match length"
                      disabled={!host || busy}
                      value={rules.length}
                      onChange={(e) =>
                        setRules((r) => ({
                          ...r,
                          length: e.target.value as MatchRules["length"],
                        }))
                      }
                    >
                      <option value="quick">Quick</option>
                      <option value="standard">Standard</option>
                      <option value="extended">Extended</option>
                    </select>
                  </label>
                  {game === "showdown" && (
                    <label className="party-spectators">
                      <input
                        type="checkbox"
                        checked={!!rules.draft}
                        disabled={!host || busy}
                        onChange={(e) =>
                          setRules((r) => ({ ...r, draft: e.target.checked }))
                        }
                      />
                      Draft a best-of-three series (off: random best-of-five)
                    </label>
                  )}
                  <label className="party-spectators">
                    <input
                      type="checkbox"
                      checked={rules.spectators}
                      disabled={
                        !host ||
                        game === "any" ||
                        !watchableGames.includes(game)
                      }
                      onChange={(e) =>
                        setRules((r) => ({
                          ...r,
                          spectators: e.target.checked,
                        }))
                      }
                    />{" "}
                    Allow spectators when both players opt in
                  </label>
                  {host && (
                    <button
                      className="button secondary compact"
                      disabled={busy || !connected}
                    >
                      Save rules
                    </button>
                  )}
                  <small className="muted">
                    Saving rules resets both ready states. Matches are unranked.
                  </small>
                </form>
                {mine?.role === "spectator" && party.watching && (
                  <button
                    className="button primary"
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(
                        new CustomEvent("dz:lobby-watch", {
                          detail: {
                            target: party.members.find(
                              (m) => m.role === "player",
                            )?.id,
                          },
                        }),
                      );
                    }}
                  >
                    Watch lobby match
                    <ArrowUpRight size={16} />
                  </button>
                )}
                <div className="party-actions">
                  <button
                    className={`button ${mine?.ready ? "secondary" : "primary"}`}
                    disabled={busy || !connected}
                    onClick={() =>
                      void act("party:ready", { ready: !mine?.ready })
                    }
                  >
                    <Check size={16} />
                    {mine?.ready ? "Not ready" : "Ready up"}
                  </button>
                  {host && (
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !connected ||
                        party.members.filter((m) => m.role === "player")
                          .length !== 2 ||
                        !party.members
                          .filter((m) => m.role === "player")
                          .every((m) => m.ready)
                      }
                      onClick={() => void act("party:launch")}
                    >
                      <Swords size={16} /> Launch match
                    </button>
                  )}
                </div>
                <section className="lobby-chat" aria-label="Lobby chat">
                  <h3>Room conversation</h3>
                  <div className="lobby-chat-messages" aria-live="polite">
                    {party.messages?.length ? (
                      party.messages.map((m) => (
                        <p key={m.id}>
                          <b>{m.username}</b>
                          <span>{m.body}</span>
                        </p>
                      ))
                    ) : (
                      <p className="muted">
                        Only members of this lobby can read these messages.
                      </p>
                    )}
                  </div>
                  <form
                    className="party-invite-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const body = chat.trim();
                      if (body) {
                        void act("party:message", {
                          id: crypto.randomUUID(),
                          body,
                        });
                        setChat("");
                      }
                    }}
                  >
                    <input
                      aria-label="Message your lobby"
                      placeholder="Message your lobby…"
                      maxLength={600}
                      value={chat}
                      onChange={(e) => setChat(e.target.value)}
                    />
                    <button
                      className="button secondary compact"
                      disabled={busy || !connected || !chat.trim()}
                    >
                      Send
                    </button>
                  </form>
                </section>
                <button
                  className="text-button muted"
                  disabled={busy}
                  onClick={() => void act("party:leave")}
                >
                  <LogOut size={14} />
                  {host ? "Close party" : "Leave party"}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
export function TournamentInvitations({
  state,
  command,
  notify,
}: {
  state: PlatformState | null;
  command: Command;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function respond(id: string, accept: boolean) {
    setBusy(true);
    try {
      await command("tournament:respond", { inviteId: id, accept });
      notify(
        accept
          ? "You are registered. The bracket is below."
          : "Invitation declined.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tournament-invitations">
      {state?.tournamentInvitations
        .filter((i) => Date.parse(i.expires_at) > Date.now())
        .map((i) => (
          <div className="party-invite" key={i.id}>
            <Swords size={21} />
            <span>
              <b>{i.name}</b>
              <small>
                Invited by {i.sender} · {GAME_INFO[i.game].name}
              </small>
            </span>
            <button
              className="button primary compact"
              disabled={busy}
              onClick={() => void respond(i.id, true)}
            >
              Register
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void respond(i.id, false)}
            >
              Decline
            </button>
          </div>
        ))}
    </div>
  );
}
export function TournamentInviteButton({
  tournament,
  social,
  command,
  notify,
}: {
  tournament: Tournament;
  social: SocialState | null;
  command: Command;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button className="text-button" onClick={() => setOpen(!open)}>
        <UserPlus size={14} /> Invite friends
      </button>
      {open && (
        <form
          className="party-invite-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await command("tournament:invite", {
                tournamentId: tournament.id,
                target,
              });
              notify("Tournament invitation sent.");
              setOpen(false);
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <select
            aria-label={`Invite friend to ${tournament.name}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose a friend…</option>
            {social?.friends
              .filter((f) => !tournament.entrants.some((p) => p.id === f.id))
              .map((f) => (
                <option value={f.id} key={f.id}>
                  {f.username}
                </option>
              ))}
          </select>
          <button
            className="button secondary compact"
            disabled={!target || busy}
          >
            Send invite
          </button>
          {!social?.friends.length && (
            <button
              type="button"
              className="text-button"
              onClick={() => openFriends()}
            >
              Add friends
            </button>
          )}
        </form>
      )}
    </>
  );
}
