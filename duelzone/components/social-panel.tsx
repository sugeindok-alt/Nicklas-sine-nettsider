"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Eye,
  History,
  MessageCircle,
  Search,
  Send,
  Settings2,
  Shield,
  Swords,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Modal from "./modal";
import { CompetitionField } from "./competition-field";
import {
  GAME_INFO,
  games,
  rankFor,
  type Game,
  type MatchState,
  type Player,
} from "@/lib/shared";
import {
  defaultRules,
  watchableGames,
  type Friend,
  type MatchRules,
  type Message,
  type Privacy,
  type SocialChallenge,
  type SocialState,
} from "@/lib/social";

type Command = (event: string, data?: unknown) => Promise<any>;
type Rivalry = { played: number; wins: number; losses: number; draws: number };
type FriendProfile = {
  player: Player;
  rating: { rating: number };
  stats: { played: number; wins: number };
  records: { game: Game; best: number; played: number }[];
};
const privacyLabels: Record<keyof Privacy, [string, string]> = {
  requests: ["Friend requests", "Let players send you requests."],
  messages: ["Private messages", "Allow messages from your friends."],
  challenges: ["Direct challenges", "Receive live invitations from friends."],
  presence: [
    "Online presence",
    "Share online and in-match status with friends.",
  ],
  spectators: [
    "Allow spectators",
    "Opt in to watching for Dodge, Grid and Aim Clash. Both players must allow it.",
  ],
};
function Avatar({ player }: { player: Player }) {
  return (
    <span
      className="avatar"
      style={{ color: player.accent, background: `${player.accent}15` }}
    >
      {player.username.slice(0, 2).toUpperCase()}
    </span>
  );
}
function Presence({ friend }: { friend: Friend }) {
  return (
    <span className={`friend-presence ${friend.presence}`}>
      <i />
      {friend.presence === "in-match"
        ? "In a match"
        : friend.presence === "hidden"
          ? "Status private"
          : friend.presence === "online"
            ? "Online"
            : "Offline"}
    </span>
  );
}
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function SocialPanel({
  user,
  socket,
  connected,
  command,
  onProfile,
  matchId,
}: {
  user: Player;
  socket: Socket | null;
  connected: boolean;
  command: Command;
  onProfile: (id: string) => void;
  matchId?: string;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("friends"),
    [social, setSocial] = useState<SocialState | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<Player[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [body, setBody] = useState("");
  const [profile, setProfile] = useState<FriendProfile | null>(null),
    [rivalry, setRivalry] = useState<Rivalry | null>(null),
    [loadingThread, setLoadingThread] = useState(false),
    [more, setMore] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState<Player | null>(null),
    [game, setGame] = useState<Game | "any">("any"),
    [rules, setRules] = useState<MatchRules>(defaultRules);
  const [notice, setNotice] = useState<{
      text: string;
      kind: string;
      target?: string;
    } | null>(null),
    [now, setNow] = useState(Date.now()),
    [watch, setWatch] = useState<MatchState | null>(null);
  const selectedRef = useRef(selected),
    openRef = useRef(open),
    mounted = useRef(true),
    messageEnd = useRef<HTMLDivElement>(null);
  selectedRef.current = selected;
  openRef.current = open;
  const refresh = useCallback(async () => {
    if (!connected) return;
    try {
      const r = await command("social:state");
      if (mounted.current) setSocial(r.social);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }, [command, connected]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 200);
    };
    const presence = (p: Pick<Friend, "id" | "presence" | "watchable">) =>
      setSocial((s) =>
        s
          ? {
              ...s,
              friends: s.friends.map((f) =>
                f.id === p.id ? { ...f, ...p } : f,
              ),
            }
          : s,
      );
    const message = (m: Message) => {
      const peer = m.from_id === user.id ? m.to_id : m.from_id;
      if (selectedRef.current === peer) {
        setMessages((old) =>
          old.some((x) => x.id === m.id) ? old : [...old, m],
        );
        if (
          openRef.current &&
          document.visibilityState === "visible" &&
          m.to_id === user.id
        )
          void command("social:read", { target: peer }).catch(() => {});
      }
      if (
        m.from_id !== user.id &&
        (!openRef.current || selectedRef.current !== peer)
      )
        setNotice({
          text: "You have a new private message.",
          kind: "message",
          target: peer,
        });
    };
    const ended = (text: string) => {
      setWatch(null);
      setNotice({ text, kind: "watch" });
    };
    socket.on("social:changed", changed);
    socket.on("social:presence", presence);
    socket.on("social:notice", setNotice);
    socket.on("social:message", message);
    socket.on("spectate", setWatch);
    socket.on("spectate:ended", ended);
    const disconnect = () => setWatch(null);
    socket.on("disconnect", disconnect);
    return () => {
      clearTimeout(timer);
      socket.off("social:changed", changed);
      socket.off("social:presence", presence);
      socket.off("social:notice", setNotice);
      socket.off("social:message", message);
      socket.off("spectate", setWatch);
      socket.off("spectate:ended", ended);
      socket.off("disconnect", disconnect);
    };
  }, [socket, refresh, command, user.id]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (matchId) {
      setOpen(false);
      setWatch(null);
      setChallengeTarget(null);
      setNotice(null);
    }
  }, [matchId]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [messages.length]);
  useEffect(() => {
    if (!selected || !open || !connected) return;
    let valid = true;
    setMessages([]);
    setProfile(null);
    setRivalry(null);
    setLoadingThread(true);
    setError("");
    void (async () => {
      try {
        const thread = await command("social:messages", { target: selected });
        if (valid) {
          setMessages(thread.messages);
          setMore(thread.messages.length === 50);
        }
        const p = await command("social:profile", { target: selected });
        if (valid) {
          setProfile(p.profile);
          setRivalry(p.rivalry);
        }
        if (valid && document.visibilityState === "visible")
          await command("social:read", { target: selected });
      } catch (e) {
        if (valid) setError((e as Error).message);
      } finally {
        if (valid) setLoadingThread(false);
      }
    })();
    return () => {
      valid = false;
    };
  }, [selected, open, connected, command]);
  useEffect(() => {
    const read = () => {
      if (
        document.visibilityState === "visible" &&
        openRef.current &&
        selectedRef.current &&
        connected
      )
        void command("social:read", { target: selectedRef.current }).catch(
          () => {},
        );
    };
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [connected, command]);
  useEffect(() => {
    if (social && selected && !social.friends.some((f) => f.id === selected)) {
      setSelected(null);
      setMessages([]);
      setProfile(null);
    }
  }, [social, selected]);
  async function act(
    event: string,
    data: unknown = {},
    after?: (r: any) => void,
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await command(event, data);
      after?.(r);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const incoming = social?.requests.filter((r) => r.to_id === user.id) || [],
    pending =
      social?.challenges.filter(
        (c) => c.status === "pending" && new Date(c.expires_at).getTime() > now,
      ) || [];
  const unread = social?.friends.reduce((n, f) => n + f.unread, 0) || 0;
  const badge =
    incoming.length +
    unread +
    pending.filter((c) => c.to_id === user.id).length;
  const friend = social?.friends.find((f) => f.id === selected);
  function chooseChallenge(p: Player) {
    setOpen(true);
    setChallengeTarget(p);
    setError("");
    setRules(defaultRules);
    setGame("any");
  }
  function invitation(c: SocialChallenge) {
    const receiving = c.to_id === user.id;
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="social-invitation"
        key={c.id}
      >
        <div className="social-invite-top">
          <Swords size={18} />
          <span>{receiving ? c.sender : c.recipient}</span>
          <small>
            {Math.max(
              0,
              Math.min(
                60,
                Math.ceil((new Date(c.expires_at).getTime() - now) / 1000),
              ),
            )}
            s
          </small>
        </div>
        <h3>{GAME_INFO[c.game].name}</h3>
        <p>
          {c.rules.length} length ·{" "}
          {c.rules.spectators ? "Spectators allowed" : "Private match"}
        </p>
        <div className="social-inline">
          {receiving ? (
            <>
              <button
                className="button primary"
                disabled={busy || !connected}
                onClick={() =>
                  void act("social:challenge:respond", {
                    challengeId: c.id,
                    accept: true,
                  })
                }
              >
                Accept duel <ArrowUpRight size={15} />
              </button>
              <button
                className="button secondary"
                disabled={busy || !connected}
                onClick={() =>
                  void act("social:challenge:respond", {
                    challengeId: c.id,
                    accept: false,
                  })
                }
              >
                Decline
              </button>
            </>
          ) : (
            <button
              className="text-button"
              disabled={busy || !connected}
              onClick={() =>
                void act("social:challenge:cancel", { challengeId: c.id })
              }
            >
              Cancel invitation
            </button>
          )}
        </div>
        <div className="invite-expiry">
          <span
            style={{
              width: `${Math.max(0, Math.min(100, (new Date(c.expires_at).getTime() - now) / 600))}%`,
            }}
          />
        </div>
      </motion.div>
    );
  }
  return (
    <>
      <motion.button
        className="social-launcher"
        whileTap={{ scale: 0.96 }}
        onClick={() => {
          setOpen(true);
          setNotice(null);
        }}
        aria-label={`Open friends${badge ? `, ${badge} notifications` : ""}`}
      >
        <Users size={19} />
        <span>Friends</span>
        {badge > 0 && <b>{badge > 99 ? "99+" : badge}</b>}
        <i className={connected ? "online" : ""} />
      </motion.button>
      <AnimatePresence>
        {notice && !open && (
          <motion.div
            role="status"
            className="social-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
          >
            <button
              className="social-toast-content"
              onClick={() => {
                setOpen(true);
                setTab(
                  notice.kind === "request"
                    ? "requests"
                    : notice.kind === "challenge"
                      ? "activity"
                      : "friends",
                );
                if (notice.kind === "message" && notice.target)
                  setSelected(notice.target);
                setNotice(null);
              }}
            >
              <MessageCircle size={20} />
              <span>
                {notice.text}
                <small>
                  Open friends <ArrowUpRight size={12} />
                </small>
              </span>
            </button>
            <button
              className="icon-button"
              aria-label="Dismiss social notification"
              onClick={() => setNotice(null)}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {!open &&
        !watch &&
        !matchId &&
        pending.some((c) => c.to_id === user.id) && (
          <aside className="social-live-invite" aria-label="Incoming challenge">
            {invitation(pending.find((c) => c.to_id === user.id)!)}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </aside>
        )}
      {open && (
        <Modal title="Your circle." onClose={() => setOpen(false)} wide>
          <div className="social-panel">
            <p className="social-intro">Good rivals make better players.</p>
            <div
              className="social-tabs"
              role="tablist"
              aria-label="Social sections"
            >
              {[
                ["friends", "Friends", Users],
                ["requests", "Requests", UserPlus],
                ["activity", "Invites", History],
                ["privacy", "Privacy", Settings2],
              ].map(([key, label, Icon]) => (
                <button
                  key={key as string}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key as string);
                    setSelected(null);
                    setChallengeTarget(null);
                    setError("");
                  }}
                >
                  <Icon size={16} />
                  {label as string}
                  {key === "requests" && incoming.length > 0 && (
                    <b>{incoming.length}</b>
                  )}
                  {key === "activity" && pending.length > 0 && (
                    <b>{pending.length}</b>
                  )}
                </button>
              ))}
            </div>
            {notice && (
              <button
                className="social-inline-notice"
                onClick={() => {
                  setTab(
                    notice.kind === "request"
                      ? "requests"
                      : notice.kind === "challenge"
                        ? "activity"
                        : "friends",
                  );
                  if (notice.kind === "message" && notice.target)
                    setSelected(notice.target);
                  else setSelected(null);
                  setNotice(null);
                }}
              >
                <MessageCircle size={15} />
                {notice.text}
                <ArrowUpRight size={14} />
              </button>
            )}
            {!connected && (
              <p className="connection-warning">
                Reconnecting… Social actions resume when you are connected.
              </p>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            {!social ? (
              <div className="empty-state">
                <div className="loading-spinner" />
                <p>Loading your friends…</p>
                <button
                  className="text-button"
                  disabled={!connected}
                  onClick={() => void refresh()}
                >
                  Retry
                </button>
              </div>
            ) : challengeTarget ? (
              <motion.div
                className="social-challenge-form"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
              >
                <button
                  className="text-button muted"
                  onClick={() => setChallengeTarget(null)}
                >
                  <ArrowLeft size={15} />
                  Back
                </button>
                <div className="social-person-heading">
                  <Avatar player={challengeTarget} />
                  <div>
                    <span className="eyebrow">DIRECT CHALLENGE</span>
                    <h3>{challengeTarget.username}</h3>
                  </div>
                  <Swords size={26} />
                </div>
                <form
                  className="form-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(
                      "social:challenge",
                      { target: challengeTarget.id, game, rules },
                      () => {
                        setChallengeTarget(null);
                        setTab("activity");
                      },
                    );
                  }}
                >
                  <label>
                    Game mode
                    <select
                      value={game}
                      onChange={(e) => {
                        setGame(e.target.value as Game | "any");
                        setRules((r) => ({ ...r, spectators: false }));
                      }}
                    >
                      <option value="any">Random · all nine games</option>
                      {games.map((g) => (
                        <option value={g} key={g}>
                          {GAME_INFO[g].name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="social-rule-options">
                    <legend>Match length</legend>
                    {(["quick", "standard", "extended"] as const).map((l) => (
                      <button
                        type="button"
                        key={l}
                        aria-pressed={rules.length === l}
                        onClick={() => setRules((r) => ({ ...r, length: l }))}
                      >
                        {l}
                        <small>
                          {l === "quick"
                            ? "⅔ length"
                            : l === "standard"
                              ? "Original rules"
                              : "1½ length"}
                        </small>
                      </button>
                    ))}
                  </fieldset>
                  <label className="social-check">
                    <input
                      type="checkbox"
                      checked={rules.spectators}
                      disabled={
                        game === "any" ||
                        !watchableGames.includes(game) ||
                        !social.settings.spectators
                      }
                      onChange={(e) =>
                        setRules((r) => ({
                          ...r,
                          spectators: e.target.checked,
                        }))
                      }
                    />
                    <span>
                      Allow friends to spectate
                      <small>
                        Choose Dodge, Grid or Aim Clash. Both players must
                        enable spectators in Privacy.
                      </small>
                    </span>
                  </label>
                  <p className="small muted">
                    Unranked · expires in 60 seconds · match starts when
                    accepted. Shorter rounds in classic games; shorter stages in
                    arena games.
                  </p>
                  <button
                    className="button primary"
                    disabled={busy || !connected}
                  >
                    Send challenge <Swords size={16} />
                  </button>
                </form>
              </motion.div>
            ) : tab === "friends" ? (
              <>
                {friend ? (
                  <motion.div
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="social-thread"
                    key={friend.id}
                  >
                    <button
                      className="text-button muted"
                      onClick={() => {
                        setSelected(null);
                        setBody("");
                      }}
                    >
                      <ArrowLeft size={15} />
                      All friends
                    </button>
                    <div className="social-person-heading">
                      <Avatar player={friend} />
                      <div>
                        <h3>{friend.username}</h3>
                        <Presence friend={friend} />
                      </div>
                      <button
                        className="button primary compact"
                        disabled={
                          !connected ||
                          friend.presence === "offline" ||
                          friend.presence === "in-match"
                        }
                        onClick={() => chooseChallenge(friend)}
                      >
                        <Swords size={15} />
                        Challenge
                      </button>
                    </div>
                    {profile && (
                      <div className="social-profile-summary">
                        <p>
                          {profile.player.bio || "A new rivalry starts here."}
                        </p>
                        <div>
                          <span>
                            <b>{rankFor(profile.rating.rating).name}</b>Current
                            rank
                          </span>
                          <span>
                            <b>{profile.stats.played}</b>Matches
                          </span>
                          <span>
                            <b>
                              {profile.stats.played
                                ? Math.round(
                                    (profile.stats.wins /
                                      profile.stats.played) *
                                      100,
                                  )
                                : 0}
                              %
                            </b>
                            Win rate
                          </span>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            onProfile(friend.id);
                            setOpen(false);
                          }}
                        >
                          Full player profile <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}
                    {rivalry && (
                      <div className="rivalry-strip">
                        <span>YOUR RIVALRY</span>
                        <strong>
                          {rivalry.wins}
                          <small>W</small> <em>—</em> {rivalry.losses}
                          <small>L</small>
                        </strong>
                        <span>
                          {rivalry.draws} draws · {rivalry.played} duels
                        </span>
                      </div>
                    )}
                    <div className="message-heading">
                      <MessageCircle size={16} />
                      <h4>Private conversation</h4>
                    </div>
                    <div
                      className="message-list"
                      role="log"
                      aria-label={`Messages with ${friend.username}`}
                      aria-live="polite"
                    >
                      {more && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              "social:messages",
                              {
                                target: friend.id,
                                before: new Date(
                                  messages[0].created_at,
                                ).toISOString(),
                              },
                              (r) => {
                                setMessages((m) => [...r.messages, ...m]);
                                setMore(r.messages.length === 50);
                              },
                            )
                          }
                        >
                          Load earlier messages
                        </button>
                      )}
                      {loadingThread ? (
                        <p className="muted small">Loading conversation…</p>
                      ) : !messages.length ? (
                        <p className="message-empty">
                          Say hello. Settle the rivalry in the arena.
                        </p>
                      ) : (
                        messages.map((m) => (
                          <div
                            key={m.id}
                            className={`private-message ${m.from_id === user.id ? "outgoing" : ""}`}
                          >
                            <p>{m.body}</p>
                            <time dateTime={m.created_at}>
                              {date(m.created_at)}
                            </time>
                          </div>
                        ))
                      )}
                      <div ref={messageEnd} />
                    </div>
                    <form
                      className="message-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!body.trim()) return;
                        void act(
                          "social:send",
                          {
                            target: friend.id,
                            body,
                            messageId: crypto.randomUUID(),
                          },
                          (r) => {
                            setBody("");
                            setMessages((old) =>
                              old.some((m) => m.id === r.message.id)
                                ? old
                                : [...old, r.message],
                            );
                          },
                        );
                      }}
                    >
                      <label className="sr-only" htmlFor="private-message">
                        Message to {friend.username}
                      </label>
                      <textarea
                        id="private-message"
                        value={body}
                        maxLength={1000}
                        rows={2}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder={`Message ${friend.username}…`}
                      />
                      <button
                        className="icon-button"
                        aria-label="Send message"
                        disabled={busy || !connected || !body.trim()}
                      >
                        <Send size={18} />
                      </button>
                    </form>
                    <p className="small muted social-message-note">
                      Only you and your friend can read this conversation in
                      DuelZone. {body.length}/1000
                    </p>
                    <div className="social-manage">
                      <button
                        className="text-button muted"
                        disabled={busy || !connected}
                        onClick={() =>
                          void act("social:remove", { target: friend.id }, () =>
                            setSelected(null),
                          )
                        }
                      >
                        Remove friend
                      </button>
                      <button
                        className="text-button"
                        disabled={busy || !connected}
                        onClick={() =>
                          void act(
                            "social:block",
                            { target: friend.id, blocked: true },
                            () => setSelected(null),
                          )
                        }
                      >
                        <Shield size={13} />
                        Block player
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <>
                    <form
                      className="social-search"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act("social:search", { query }, (r) =>
                          setResults(r.players),
                        );
                      }}
                    >
                      <Search size={18} />
                      <input
                        aria-label="Search players by username"
                        placeholder="Find a player by username"
                        value={query}
                        minLength={2}
                        maxLength={20}
                        pattern="[a-zA-Z0-9_]+"
                        required
                        onChange={(e) => {
                          setQuery(e.target.value);
                          if (!e.target.value) setResults(null);
                        }}
                      />
                      <button
                        className="text-button"
                        disabled={busy || !connected}
                      >
                        Search
                      </button>
                    </form>
                    {results && (
                      <section className="social-search-results">
                        <div className="social-section-heading">
                          <span>SEARCH RESULTS</span>
                          <button
                            className="text-button"
                            onClick={() => {
                              setResults(null);
                              setQuery("");
                            }}
                          >
                            Clear
                          </button>
                        </div>
                        {!results.length && (
                          <p className="small muted">
                            No players found. Try another username.
                          </p>
                        )}
                        {results.map((p) => {
                          const known = social.friends.some(
                              (f) => f.id === p.id,
                            ),
                            request = social.requests.some(
                              (r) => r.id === p.id,
                            );
                          return (
                            <div className="friend-row" key={p.id}>
                              <Avatar player={p} />
                              <span className="friend-name">
                                {p.username}
                                <small>
                                  {known
                                    ? "Already friends"
                                    : request
                                      ? "Request pending"
                                      : "DuelZone player"}
                                </small>
                              </span>
                              <button
                                className="icon-button"
                                title="Send friend request"
                                aria-label={`Add ${p.username}`}
                                disabled={
                                  busy || !connected || known || request
                                }
                                onClick={() =>
                                  void act("social:request", { target: p.id })
                                }
                              >
                                {known ? (
                                  <Check size={17} />
                                ) : (
                                  <UserPlus size={17} />
                                )}
                              </button>
                              <button
                                className="icon-button"
                                title="Block player"
                                aria-label={`Block ${p.username}`}
                                disabled={busy || !connected}
                                onClick={() =>
                                  void act(
                                    "social:block",
                                    { target: p.id, blocked: true },
                                    () =>
                                      setResults(
                                        (r) =>
                                          r?.filter((x) => x.id !== p.id) ||
                                          null,
                                      ),
                                  )
                                }
                              >
                                <Shield size={15} />
                              </button>
                            </div>
                          );
                        })}
                      </section>
                    )}
                    <div className="social-section-heading">
                      <span>
                        YOUR FRIENDS <b>{social.friends.length}</b>
                      </span>
                      <small>
                        {
                          social.friends.filter(
                            (f) =>
                              f.presence === "online" ||
                              f.presence === "in-match",
                          ).length
                        }{" "}
                        online
                      </small>
                    </div>
                    {!social.friends.length ? (
                      <div className="social-empty">
                        <Users size={36} strokeWidth={1} />
                        <h3>Build your circle.</h3>
                        <p>
                          Find a player above and send your first friend
                          request. Your next great rivalry starts with hello.
                        </p>
                      </div>
                    ) : (
                      <div className="friends-list">
                        <AnimatePresence>
                          {[...social.friends]
                            .sort(
                              (a, b) =>
                                Number(b.presence === "online") -
                                  Number(a.presence === "online") ||
                                a.username.localeCompare(b.username),
                            )
                            .map((f) => (
                              <motion.div
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: 12 }}
                                className="friend-row"
                                key={f.id}
                              >
                                <button
                                  className="friend-open"
                                  onClick={() => {
                                    setSelected(f.id);
                                    setBody("");
                                  }}
                                >
                                  <Avatar player={f} />
                                  <span className="friend-name">
                                    {f.username}
                                    <Presence friend={f} />
                                  </span>
                                  {f.unread > 0 && (
                                    <b className="social-unread">{f.unread}</b>
                                  )}
                                </button>
                                {f.watchable && (
                                  <button
                                    className="icon-button"
                                    aria-label={`Watch ${f.username}`}
                                    disabled={busy || !connected}
                                    onClick={() =>
                                      void act(
                                        "social:watch",
                                        { target: f.id },
                                        (r) => {
                                          setWatch(r.state);
                                          setOpen(false);
                                        },
                                      )
                                    }
                                  >
                                    <Eye size={18} />
                                  </button>
                                )}
                                <button
                                  className="icon-button"
                                  title="Challenge friend"
                                  aria-label={`Challenge ${f.username}`}
                                  disabled={
                                    !connected ||
                                    f.presence === "offline" ||
                                    f.presence === "in-match"
                                  }
                                  onClick={() => chooseChallenge(f)}
                                >
                                  <Swords size={18} />
                                </button>
                              </motion.div>
                            ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : tab === "requests" ? (
              <>
                <div className="social-section-heading">
                  <span>FRIEND REQUESTS</span>
                  <small>{social.requests.length} pending</small>
                </div>
                {!social.requests.length && (
                  <div className="social-empty">
                    <UserPlus size={32} strokeWidth={1} />
                    <h3>All caught up.</h3>
                    <p>Incoming and outgoing friend requests appear here.</p>
                  </div>
                )}
                {social.requests.map((r) => (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="friend-request"
                    key={r.id}
                  >
                    <div className="friend-row">
                      <Avatar player={r} />
                      <span className="friend-name">
                        {r.username}
                        <small>
                          {r.to_id === user.id
                            ? "Wants to be your friend"
                            : "Waiting for their response"}
                        </small>
                      </span>
                    </div>
                    <div className="social-inline">
                      {r.to_id === user.id ? (
                        <>
                          <button
                            className="button primary compact"
                            disabled={busy || !connected}
                            onClick={() =>
                              void act("social:respond", {
                                target: r.id,
                                accept: true,
                              })
                            }
                          >
                            <Check size={15} />
                            Accept
                          </button>
                          <button
                            className="button secondary compact"
                            disabled={busy || !connected}
                            onClick={() =>
                              void act("social:respond", {
                                target: r.id,
                                accept: false,
                              })
                            }
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <button
                          className="text-button"
                          disabled={busy || !connected}
                          onClick={() =>
                            void act("social:remove", { target: r.id })
                          }
                        >
                          Cancel request
                        </button>
                      )}
                      <button
                        className="text-button muted"
                        disabled={busy || !connected}
                        onClick={() =>
                          void act("social:block", {
                            target: r.id,
                            blocked: true,
                          })
                        }
                      >
                        Block
                      </button>
                    </div>
                  </motion.div>
                ))}
              </>
            ) : tab === "activity" ? (
              <>
                {pending.map(invitation)}
                <div className="social-section-heading">
                  <span>CHALLENGE HISTORY</span>
                  <small>Latest 50</small>
                </div>
                {!social.challenges.length && (
                  <div className="social-empty">
                    <Swords size={32} strokeWidth={1} />
                    <h3>Call your rival.</h3>
                    <p>
                      Challenge an online friend. No links, no waiting room.
                    </p>
                  </div>
                )}
                {social.challenges
                  .filter(
                    (c) =>
                      c.status !== "pending" ||
                      new Date(c.expires_at).getTime() <= now,
                  )
                  .map((c) => (
                    <div className="challenge-history" key={c.id}>
                      <Swords size={16} />
                      <div>
                        <strong>
                          {c.from_id === user.id ? c.recipient : c.sender}
                        </strong>
                        <small>
                          {GAME_INFO[c.game].name} · {c.rules.length} ·{" "}
                          {date(c.created_at)}
                        </small>
                      </div>
                      <span>
                        {c.status === "pending" ? "expired" : c.status}
                      </span>
                    </div>
                  ))}
              </>
            ) : (
              <>
                <div className="social-section-heading">
                  <span>YOUR SOCIAL SPACE</span>
                  <Shield size={16} />
                </div>
                {(Object.keys(privacyLabels) as (keyof Privacy)[]).map(
                  (key) => (
                    <label className="privacy-row" key={key}>
                      <span>
                        <strong>{privacyLabels[key][0]}</strong>
                        <small>{privacyLabels[key][1]}</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={social.settings[key]}
                        disabled={busy || !connected}
                        onChange={(e) =>
                          void act("social:settings", {
                            ...social.settings,
                            [key]: e.target.checked,
                          })
                        }
                      />
                    </label>
                  ),
                )}
                <div className="social-section-heading">
                  <span>BLOCKED PLAYERS</span>
                  <small>{social.blocked.length}</small>
                </div>
                {!social.blocked.length ? (
                  <p className="small muted">
                    No blocked players. Blocking removes the friendship and
                    stops messages, invitations and spectating between you.
                  </p>
                ) : (
                  social.blocked.map((p) => (
                    <div className="friend-row" key={p.id}>
                      <Avatar player={p} />
                      <span className="friend-name">{p.username}</span>
                      <button
                        className="text-button"
                        disabled={busy || !connected}
                        onClick={() =>
                          void act("social:block", {
                            target: p.id,
                            blocked: false,
                          })
                        }
                      >
                        Unblock
                      </button>
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {watch && (
        <Modal
          wide
          title={`Watching ${GAME_INFO[watch.game].name}`}
          onClose={() => {
            setWatch(null);
            void command("social:unwatch").catch(() => {});
          }}
        >
          <div className="social-spectator">
            <div className="spectator-label">
              <Eye size={16} />
              SPECTATOR · READ ONLY
            </div>
            <div className="spectator-score">
              {watch.players.map((p) => (
                <span key={p.id}>
                  <Avatar player={p} />
                  {p.username}
                  <b>{watch.scores[p.id]}</b>
                </span>
              ))}
            </div>
            {watch.phase === "finished" ? (
              <div className="social-empty">
                <h3>
                  {watch.winner
                    ? `${watch.players.find((p) => p.id === watch.winner)?.username} wins.`
                    : "A draw."}
                </h3>
                <p>The match has finished.</p>
              </div>
            ) : watch.competition ? (
              <CompetitionField
                state={watch}
                userId={watch.players[0].id}
                onAction={() => {}}
                readOnly
              />
            ) : (
              <div className="social-empty">
                <h3>Players getting ready…</h3>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
