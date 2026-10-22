"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { io, type Socket } from "socket.io-client";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
  Activity,
  Bot,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Crosshair,
  Gamepad2,
  History,
  Info,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Shield,
  Signal,
  Swords,
  Trophy,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  GAME_INFO,
  RANKS,
  games,
  featuredGames,
  isCompetition,
  rankFor,
  type Game,
  type MatchState,
  type Player,
} from "@/lib/shared";
import { frontierGames, isFrontier } from "@/lib/frontier";
import { matchFeed, network } from "@/lib/match-feed";
import { api } from "@/lib/client";
import GameArt, { gameIcons } from "./game-art";
import Modal from "./modal";
import { ProgressionPanel } from "./progression";
import type { Progression } from "@/lib/progression";
import { AIPicker } from "./ai-picker";
import { AnimatedNumber } from "./animated-number";
import type { Difficulty } from "@/lib/bot";
import Arena, { Practice } from "./arena";
import {
  PlayerAvatar,
  ProfileExtras,
  ProfileMediaEditor,
} from "./profile-extras";
import {
  PartyPanel,
  TournamentInvitations,
  TournamentInviteButton,
} from "./party-panel";
import { GameLibrary } from "./game-library";
import { Dashboard } from "./dashboard";
import { defaultPreferences } from "@/lib/platform";
import { NotificationCenter, usePlatform } from "./platform-center";
import type { SocialState } from "@/lib/social";
import { SocialPanel } from "./social-panel";

type View =
  | "dashboard"
  | "arena"
  | "leaderboard"
  | "tournaments"
  | "profile"
  | "history"
  | "settings";
type Pending =
  | { game: Game | "any"; mode: "ranked" | "casual" | "friend" }
  | { ai: Game; difficulty: Difficulty }
  | { invite: string };
type Overview = {
  online: number;
  queued: number;
  playing: number;
  completed: number;
  season: { id: string; name: string; end: string };
};
type BoardRow = Player & { rating: number; games: number; wins: number };
export type Profile = {
  favorites?: Game[];
  rankHistory?: { rating: number; season_id: string; created_at: string }[];
  seasons?: {
    season_id: string;
    rating: number;
    games: number;
    wins: number;
  }[];
  rivals?: {
    id: string;
    username: string;
    accent: string;
    played: number;
    wins: number;
    losses: number;
  }[];
  progression: Progression;
  player: Player;
  rating: { rating: number; games: number; wins: number };
  stats: { played: number; wins: number; draws: number; best: number };
  records: { game: Game; best: number; played: number; wins: number }[];
  history: {
    id: string;
    game: Game;
    mode: string;
    status: string;
    winner_id: string | null;
    reason: string;
    ended_at: string;
    score: number;
    opponent: string;
    opponent_score: number;
    details?: import("@/lib/frontier").RoundRecord[];
    rating_change: number;
  }[];
};
export type Tournament = {
  id: string;
  name: string;
  game: Game;
  host_id: string;
  host: string;
  status: string;
  winner: string | null;
  entrants: Player[];
  fixtures: {
    round: number;
    slot: number;
    name_a: string;
    name_b: string;
    winner: string | null;
  }[];
};
const nav = [
  { id: "dashboard", label: "Home", icon: Activity },
  { id: "arena", label: "The arena", icon: Gamepad2 },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "tournaments", label: "Tournaments", icon: Swords },
  { id: "profile", label: "Your profile", icon: User },
  { id: "history", label: "Match history", icon: History },
] as const;
const emptyOverview: Overview = {
  online: 0,
  queued: 0,
  playing: 0,
  completed: 0,
  season: { id: "", name: "Current season", end: "" },
};

export default function DuelZone() {
  const [view, setView] = useState<View>("arena"),
    [mobile, setMobile] = useState(false);
  const [user, setUser] = useState<Player | null>(null),
    [loaded, setLoaded] = useState(false),
    [connected, setConnected] = useState(false),
    [serverUp, setServerUp] = useState(false);
  const [overview, setOverview] = useState<Overview>(emptyOverview),
    [board, setBoard] = useState<BoardRow[]>([]),
    [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null),
    [ownProfile, setOwnProfile] = useState<Profile | null>(null),
    [profileId, setProfileId] = useState<string | null>(null);
  const [game, setGame] = useState<Game>("knockout"),
    [mode, setMode] = useState<"ranked" | "casual">("ranked"),
    [practice, setPractice] = useState<Game | null>(null);
  const [auth, setAuth] = useState<"login" | "register" | null>(null),
    [help, setHelp] = useState(false),
    [createTournament, setCreateTournament] = useState(false);
  const [aiPicker, setAiPicker] = useState(false);
  const [queue, setQueue] = useState<{
      game: Game | "any";
      at: number;
      invite?: string;
    } | null>(null),
    [match, setMatch] = useState<MatchState | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [toast, setToast] = useState(""),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [search, setSearch] = useState("");
  const socket = useRef<Socket | null>(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    function read() {
      const next = location.hash.slice(1);
      if (
        [
          "dashboard",
          "arena",
          "leaderboard",
          "tournaments",
          "profile",
          "history",
          "settings",
        ].includes(next)
      )
        setView(next as View);
    }
    read();
    window.addEventListener("hashchange", read);
    const parameters = new URLSearchParams(location.search);
    const sharedPlayer = parameters.get("player");
    if (sharedPlayer && /^[a-f0-9-]{36}$/.test(sharedPlayer)) {
      setProfileId(sharedPlayer);
      setView("profile");
    }
    const invite = parameters.get("invite");
    if (invite) {
      setPending({ invite });
      history.replaceState(null, "", location.pathname + location.hash);
    }
    api("/me")
      .then((data) => {
        setUser(data.player);
        if (data.player && !location.hash) setView("dashboard");
        if (invite && !data.player) setAuth("login");
      })
      .catch((e) => notify(e.message))
      .finally(() => setLoaded(true));
    return () => window.removeEventListener("hashchange", read);
  }, [notify]);
  const refresh = useCallback(async () => {
    try {
      const [o, b, t] = await Promise.all([
        api<Overview>("/overview"),
        api<{ rows: BoardRow[] }>("/leaderboard"),
        api<{ tournaments: Tournament[] }>("/tournaments"),
      ]);
      setOverview(o);
      setBoard(b.rows);
      setTournaments(t.tournaments);
      setServerUp(true);
    } catch {
      setServerUp(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => clearInterval(timer);
  }, [refresh, tick]);
  useEffect(() => {
    if (!user) {
      setOwnProfile(null);
      return;
    }
    api<Profile>(`/profile/${user.id}`)
      .then(setOwnProfile)
      .catch((e) => notify(e.message));
  }, [user, tick, notify]);
  useEffect(() => {
    const id = profileId || user?.id;
    if (!id) {
      setProfile(null);
      return;
    }
    setProfile(null);
    let valid = true;
    api<Profile>(`/profile/${id}`)
      .then((p) => {
        if (valid) setProfile(p);
      })
      .catch((e) => notify(e.message));
    return () => {
      valid = false;
    };
  }, [profileId, user, tick, notify]);
  useEffect(() => {
    if (!user) return;
    const s = io({
      transports: ["websocket"],
      reconnection: true,
      auth: { frames: true },
    });
    socket.current = s;
    const ping = () => {
      const at = performance.now();
      if (s.connected)
        s.timeout(1500).volatile.emit("clock", (error: Error | null) => {
          if (!error) network.rtt = performance.now() - at;
        });
    };
    const pingTimer = setInterval(ping, 4000);
    s.on("connect", () => {
      setConnected(true);
      ping();
    });
    s.on("frame", matchFeed.frame);
    s.on("disconnect", () => {
      setConnected(false);
      if (queueRef.current)
        notify(
          "Connection lost. Your search was cancelled. Reconnect and try again.",
        );
      setQueue(null);
    });
    s.on("connect_error", (e: Error) => {
      setConnected(false);
      if (e.message === "Please sign in.")
        notify("Your session expired. Sign in again.");
    });
    s.on("match", (state: MatchState) => {
      if (!state) return;
      matchFeed.publish(state);
      setMatch(state);
      setQueue(null);
      if (state.phase === "finished") setTick((t) => t + 1);
    });
    s.on("lobby", (data) => setOverview((o) => ({ ...o, ...data })));
    s.on("refresh", () => setTick((t) => t + 1));
    s.on("notice", notify);
    s.on("queue:cancelled", () => setQueue(null));
    s.on("replaced", () =>
      notify(
        "Your account connected in another tab. Use that tab for multiplayer.",
      ),
    );
    return () => {
      clearInterval(pingTimer);
      s.disconnect();
      socket.current = null;
      setConnected(false);
    };
  }, [user?.id, notify]);
  const command = useCallback(
    (event: string, data: unknown = {}) =>
      new Promise<any>((resolve, reject) => {
        if (!socket.current?.connected) {
          reject(
            new Error(
              "The live connection is not ready. Please wait a moment.",
            ),
          );
          return;
        }
        socket.current
          .timeout(12000)
          .emit(
            event,
            data,
            (error: Error | null, result: { error?: string }) => {
              if (error)
                reject(
                  new Error("The server did not respond. Please try again."),
                );
              else if (result.error) reject(new Error(result.error));
              else resolve(result);
            },
          );
      }),
    [],
  );
  const platform = usePlatform(user?.id, socket.current, connected, command);
  const [social, setSocial] = useState<SocialState | null>(null);
  const begin = useCallback(
    async (action: Pending) => {
      setBusy(true);
      try {
        if ("ai" in action) {
          await command("ai:start", {
            game: action.ai,
            difficulty: action.difficulty,
          });
          setAiPicker(false);
        } else if ("invite" in action) {
          await command("invite:join", { code: action.invite });
        } else if (action.mode === "friend") {
          const result = await command("invite:create", { game: action.game });
          setQueue({
            game: action.game,
            at: Date.now(),
            invite: `${location.origin}/?invite=${result.code}`,
          });
        } else {
          setQueue({ game: action.game, at: Date.now() });
          await command("queue:join", action);
        }
      } catch (e) {
        setQueue(null);
        notify((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [command, notify],
  );
  useEffect(() => {
    if (user && connected && pending) {
      const action = pending;
      setPending(null);
      void begin(action);
    }
  }, [user, connected, pending, begin]);
  function play(
    selected: Game | "any" = game,
    selectedMode: "ranked" | "casual" | "friend" = mode,
  ) {
    const action = { game: selected, mode: selectedMode };
    if (!user) {
      setPending(action);
      setAuth("register");
      return;
    }
    void begin(action);
  }
  function navigate(next: View) {
    setView(next);
    setMobile(false);
    location.hash = next;
    if (next === "profile") setProfileId(null);
  }
  function showProfile(id: string) {
    setProfileId(id);
    setView("profile");
    location.hash = "profile";
  }
  async function leaveQueue() {
    try {
      await command("queue:leave");
      setQueue(null);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function logout() {
    try {
      await api("/auth/logout", {});
      setUser(null);
      setMatch(null);
      setQueue(null);
      navigate("arena");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function tournamentAction(
    id: string,
    action: "join" | "leave" | "start",
  ) {
    if (!user) {
      setAuth("register");
      return;
    }
    setBusy(true);
    try {
      if (action === "start") await command("tournament:start", { id });
      else await api(`/tournaments/${id}/${action}`, {});
      setTick((t) => t + 1);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rating = ownProfile?.rating.rating || 1000;
  const currentRank = rankFor(rating),
    nextRank = RANKS.find((r) => r.min > rating);
  const progress = nextRank
    ? Math.max(
        0,
        Math.min(
          100,
          ((rating - currentRank.min) / (nextRank.min - currentRank.min)) * 100,
        ),
      )
    : 100;
  const GameIcon = gameIcons[game];
  const pageTitle = {
    dashboard: "Your dashboard",
    arena: "The arena",
    leaderboard: "Leaderboard",
    tournaments: "Tournaments",
    profile: "Player profile",
    history: "Match history",
    settings: "Account settings",
  }[view];
  function gate() {
    return (
      <div className="empty-state tall">
        <Shield size={34} />
        <h2>Your next chapter starts here.</h2>
        <p>
          Create your player profile to track wins, climb the ranks and make
          every match count.
        </p>
        <button className="button primary" onClick={() => setAuth("register")}>
          Create account
          <ArrowRight size={16} />
        </button>
        <button className="text-button" onClick={() => setAuth("login")}>
          Already a player? Sign in
        </button>
      </div>
    );
  }
  function boardTable(rows: BoardRow[], compact = false) {
    return rows.length ? (
      <div className="table-scroll">
        <table className="board-table">
          <thead>
            <tr>
              <th>#</th>
              <th>PLAYER</th>
              <th>RANK</th>
              <th>RATING</th>
              {!compact && (
                <>
                  <th>MATCHES</th>
                  <th>WIN RATE</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <motion.tr
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                key={p.id}
              >
                <td className={i < 3 ? "top-place" : ""}>
                  {String(board.indexOf(p) + 1 || i + 1).padStart(2, "0")}
                </td>
                <td>
                  <button
                    className="player-link"
                    onClick={() => showProfile(p.id)}
                  >
                    <span
                      className="avatar small-avatar"
                      style={{ color: p.accent, background: `${p.accent}15` }}
                    >
                      {p.username.slice(0, 2).toUpperCase()}
                    </span>
                    {p.username}
                    {p.id === user?.id && <small>YOU</small>}
                  </button>
                </td>
                <td>
                  <span className="rank-label">
                    <Shield size={13} />
                    {rankFor(p.rating).name}
                  </span>
                </td>
                <td className="mono bright">
                  <AnimatedNumber value={p.rating} />
                </td>
                {!compact && (
                  <>
                    <td>{p.games}</td>
                    <td>{Math.round((p.wins / p.games) * 100)}%</td>
                  </>
                )}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty-state">
        <Trophy size={28} />
        <h3>
          {search ? "No players found" : "The first place is yours to claim."}
        </h3>
        <p>
          {search
            ? "Try another player name."
            : "Finish a ranked match to join this season’s leaderboard."}
        </p>
        {!search && (
          <button
            className="text-button accent"
            onClick={() => play(game, "ranked")}
          >
            Play your first ranked match
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {mobile && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        )}
        <aside
          className={`sidebar ${mobile ? "open" : ""}`}
          inert={Boolean(
            match ||
              auth ||
              practice ||
              help ||
              queue ||
              createTournament ||
              aiPicker,
          )}
        >
          <a
            href="#arena"
            className="wordmark brand"
            onClick={() => navigate("arena")}
          >
            <span className="brand-mark">
              <i />
              <i />
            </span>
            DUELZONE<span className="brand-period">®</span>
          </a>
          <div className="workspace-label">THE COMPETITIVE PLAYGROUND</div>
          <div className="nav-group-label">PLAY & COMPETE</div>
          <nav aria-label="Main navigation">
            {nav
              .filter((item) => user || item.id !== "dashboard")
              .map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`nav-item ${view === item.id ? "active" : ""}`}
                  onClick={() => navigate(item.id)}
                  aria-current={view === item.id ? "page" : undefined}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  {view === item.id && <i />}
                </a>
              ))}
          </nav>
          <div className="sidebar-season">
            <div className="season-icon">
              <Shield size={26} strokeWidth={1.2} />
            </div>
            <p className="eyebrow">{overview.season.name}</p>
            <h3>A fresh chance to rise.</h3>
            <p>
              One opponent. One match.
              <br />
              One step closer.
            </p>
            <button
              className="text-button"
              onClick={() => navigate("leaderboard")}
            >
              Explore the ranks
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setHelp(true)}>
              <Info size={18} />
              How to play
              <ArrowUpRight size={14} />
            </button>
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings size={18} />
              Settings
            </button>
            <div className="server-status">
              <i className={`status-dot ${serverUp ? "" : "offline"}`} />
              {serverUp ? "All systems operational" : "Connecting to server"}
            </div>
          </div>
        </aside>
        <div
          className="main-shell"
          inert={Boolean(
            match ||
              auth ||
              practice ||
              help ||
              queue ||
              createTournament ||
              aiPicker,
          )}
        >
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="icon-button mobile-menu"
                onClick={() => setMobile(true)}
                aria-label="Open navigation"
              >
                <Menu size={21} />
              </button>
              <span className="breadcrumb">PLAY</span>
              <ChevronRight size={13} />
              <strong>{pageTitle}</strong>
            </div>
            <div className="topbar-right">
              <span className="online-count">
                <i className="status-dot" />
                {serverUp ? overview.online.toLocaleString() : "—"} online
              </span>
              {user && (
                <PartyPanel
                  user={user}
                  state={platform.state}
                  social={social}
                  command={command}
                  connected={connected}
                  matchId={match?.phase !== "finished" ? match?.id : undefined}
                />
              )}
              {user && (
                <NotificationCenter
                  state={platform.state}
                  command={command}
                  onNavigate={navigate}
                  error={platform.error}
                />
              )}
              <span className="topbar-divider" />
              {user ? (
                <button
                  className="account-button"
                  onClick={() => navigate("profile")}
                >
                  <span
                    className="avatar small-avatar"
                    style={{
                      color: user.accent,
                      background: `${user.accent}18`,
                    }}
                  >
                    {user.avatar ? (
                      <img src={user.avatar} alt="" />
                    ) : (
                      user.username.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span>
                    {user.username}
                    <small>
                      {currentRank.name} · {rating} RP
                    </small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ) : (
                <>
                  <button
                    className="text-button sign-in"
                    onClick={() => setAuth("login")}
                  >
                    Sign in
                  </button>
                  <button
                    className="button primary compact"
                    disabled={!loaded}
                    onClick={() => setAuth("register")}
                  >
                    Join DuelZone
                    <ArrowUpRight size={15} />
                  </button>
                </>
              )}
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.22 }}
              >
                {view === "dashboard" &&
                  (ownProfile ? (
                    <Dashboard
                      profile={ownProfile}
                      social={social}
                      tournaments={tournaments}
                      preferences={
                        platform.state?.preferences || defaultPreferences
                      }
                      play={(g) => play(g, "casual")}
                      practice={setPractice}
                      navigate={navigate}
                      command={command}
                      notify={notify}
                    />
                  ) : user ? (
                    <Loading />
                  ) : (
                    gate()
                  ))}
                {view === "arena" && (
                  <>
                    <div className="page-intro">
                      <div>
                        <p className="eyebrow">YOUR NEXT RIVAL IS OUT THERE</p>
                        <h1>
                          {user
                            ? `Good to see you, ${user.username}.`
                            : "Welcome to your proving ground."}
                        </h1>
                      </div>
                      <span className="subtle-tag">
                        <Signal size={13} />
                        REAL-TIME 1V1
                      </span>
                    </div>
                    <section className="hero">
                      <div className="hero-copy">
                        <span className="hero-kicker">
                          <span />
                          PURE SKILL. REAL COMPETITION.
                        </span>
                        <h2>
                          Small margins.
                          <br />
                          <span>Big wins.</span>
                        </h2>
                        <p>
                          No loadouts. No luck. Just you, your opponent,
                          <br className="desktop-break" /> and the moment that
                          makes the difference.
                        </p>
                        <div className="hero-actions">
                          <button
                            className="button primary"
                            onClick={() => play("any", "casual")}
                            disabled={busy}
                          >
                            <Zap size={17} fill="currentColor" />
                            Quick Match
                            <ArrowUpRight size={18} />
                          </button>
                          <button
                            className="button ghost"
                            onClick={() =>
                              user
                                ? window.dispatchEvent(
                                    new CustomEvent("dz:friends"),
                                  )
                                : setAuth("login")
                            }
                          >
                            <Users size={17} />
                            Challenge a friend
                          </button>
                        </div>
                        <button
                          className="text-button ai-entry"
                          onClick={() => setAiPicker(true)}
                        >
                          <Bot size={17} /> Play vs AI{" "}
                          <span>4 difficulty levels</span>
                          <ArrowRight size={15} />
                        </button>
                        <div className="hero-footnote">
                          <span>
                            <Shield size={13} />
                            Skill-based matchmaking
                          </span>
                          <i />
                          <span>Free to compete</span>
                        </div>
                      </div>
                      <button
                        className="hero-visual"
                        onClick={() => setPractice("clash")}
                        aria-label="Try the Aim Clash interactive preview"
                      >
                        <div className="hero-orbit orbit-one" />
                        <div className="hero-orbit orbit-two" />
                        <div className="hero-orbit orbit-three" />
                        <svg
                          viewBox="0 0 500 400"
                          className="hero-lines"
                          aria-hidden="true"
                        >
                          <path d="M0 340L500 70M70 400L500 170M0 210L420 0M-30 100L180 0" />
                          <path
                            className="hero-line-accent"
                            d="M100 400L500 0"
                          />
                        </svg>
                        <div className="hero-crosshair">
                          <i />
                          <i />
                          <span />
                        </div>
                        <div className="hero-target target-back" />
                        <div className="hero-coordinate coord-top">
                          DZ // COMPETITIVE SYSTEMS
                        </div>
                        <div className="hero-coordinate coord-bottom">
                          <span className="status-dot" />
                          ENTER THE ZONE
                          <ArrowUpRight size={16} />
                        </div>
                        <span className="visual-index">
                          PHYSICS. TACTICS. COMPETITION.
                        </span>
                      </button>
                    </section>
                    {ownProfile?.progression && (
                      <ProgressionPanel
                        progress={ownProfile.progression}
                        compact
                      />
                    )}
                    <section className="showdown-feature">
                      <div>
                        <span className="eyebrow">
                          THE COMPLETE COMPETITOR / NEW
                        </span>
                        <h2>DuelZone Showdown.</h2>
                        <p>
                          One rival. Five disciplines. A new draw every series.
                          Win three rounds across combat, movement, sport and
                          tactics to take the match.
                        </p>
                      </div>
                      <div>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => play("showdown", mode)}
                        >
                          <Swords size={17} /> Enter Showdown{" "}
                          <ArrowUpRight size={17} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setPractice("showdown")}
                        >
                          Learn the series <ArrowRight size={16} />
                        </button>
                      </div>
                    </section>
                    <GameLibrary
                      ready={!!platform.state}
                      selected={game}
                      onSelect={setGame}
                      onPractice={setPractice}
                      preferences={
                        platform.state?.preferences || defaultPreferences
                      }
                      save={async (prefs) => {
                        await command("preferences:save", prefs);
                        await platform.refresh();
                        setTick((t) => t + 1);
                      }}
                      onLogin={() => setAuth("login")}
                      profile={ownProfile}
                    />
                    <div className="play-strip">
                      <div className="selected-game-icon">
                        <GameIcon size={22} />
                      </div>
                      <div>
                        <strong>{GAME_INFO[game].name}</strong>
                        <span>
                          {isFrontier(game)
                            ? game === "showdown"
                              ? "Best of five"
                              : "90 seconds"
                            : isCompetition(game)
                              ? game === "arena"
                                ? "6 stages"
                                : game === "mind"
                                  ? "6 puzzles"
                                  : "45–60 seconds"
                              : `${GAME_INFO[game].rounds} rounds`}{" "}
                          · {GAME_INFO[game].keys.toLowerCase()}
                        </span>
                      </div>
                      <div className="mode-toggle" aria-label="Match type">
                        <button
                          aria-pressed={mode === "ranked"}
                          className={mode === "ranked" ? "active" : ""}
                          onClick={() => setMode("ranked")}
                        >
                          <Shield size={14} />
                          Ranked
                        </button>
                        <button
                          aria-pressed={mode === "casual"}
                          className={mode === "casual" ? "active" : ""}
                          onClick={() => setMode("casual")}
                        >
                          Casual
                        </button>
                      </div>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => play()}
                      >
                        Find a match
                        <ArrowRight size={17} />
                      </button>
                    </div>
                    <div className="lower-grid">
                      <section className="panel">
                        <div className="panel-heading">
                          <h2>
                            <Trophy size={17} />
                            Setting the standard
                          </h2>
                          <button
                            className="text-button muted"
                            onClick={() => navigate("leaderboard")}
                          >
                            Full leaderboard
                            <ArrowUpRight size={15} />
                          </button>
                        </div>
                        {boardTable(board.slice(0, 5), true)}
                        <div className="panel-footer">
                          <span className="status-dot" />
                          {overview.season.name}
                          <span>Updated from completed ranked matches</span>
                        </div>
                      </section>
                      <section className="rank-panel">
                        <div className="rank-top">
                          <span className="eyebrow">
                            YOUR CLIMB STARTS HERE
                          </span>
                          <ArrowUpRight size={17} />
                        </div>
                        <div className="rank-feature">
                          <div className="rank-shield">
                            <Shield size={45} strokeWidth={1} />
                            <span>
                              {user ? currentRank.name.charAt(0) : "I"}
                            </span>
                          </div>
                          <div>
                            <p>{user ? currentRank.name : "Make your mark."}</p>
                            <span>
                              {user
                                ? `${rating.toLocaleString()} rating points`
                                : "From Bronze to Champion."}
                            </span>
                          </div>
                        </div>
                        <div className="rank-track">
                          <div style={{ width: `${user ? progress : 0}%` }} />
                        </div>
                        <div className="rank-progress-label">
                          <span>{user ? currentRank.name : "Bronze"}</span>
                          <span>
                            {user
                              ? nextRank
                                ? `${nextRank.min - rating} RP to ${nextRank.name}`
                                : "Champion reached"
                              : "Champion"}
                          </span>
                        </div>
                        <p className="rank-description">
                          {user
                            ? "Show up. Stay sharp. Let your skill do the talking."
                            : "Your rank is earned, never given. Start with one match and see how far you can go."}
                        </p>
                        <button
                          className="text-button accent"
                          onClick={() =>
                            user ? navigate("profile") : setAuth("register")
                          }
                        >
                          {user ? "View your progress" : "Start your journey"}
                          <ArrowRight size={15} />
                        </button>
                      </section>
                    </div>
                    <div className="arena-footer">
                      <span>BUILT FOR THE COMPETITIVE SPIRIT.</span>
                      <div>
                        <span>{games.length} competitive games</span>
                        <i />
                        <span>Real opponents</span>
                        <i />
                        <span>Zero pay-to-win</span>
                      </div>
                      <span>DUELZONE © {new Date().getFullYear()}</span>
                    </div>
                  </>
                )}
                {view === "leaderboard" && (
                  <>
                    <PageHeading
                      eyebrow="EARN YOUR PLACE"
                      title="The best rise to the top."
                      description="Every point earned against a real opponent. Every position worth defending."
                    />
                    <div className="leaderboard-banner">
                      <Shield size={40} strokeWidth={1} />
                      <div>
                        <span className="eyebrow">CURRENT COMPETITION</span>
                        <h2>{overview.season.name}</h2>
                      </div>
                      <div className="banner-stat">
                        <strong>{board.length}</strong>
                        <span>
                          ranked players
                          {board.length === 100 ? " · top 100" : ""}
                        </span>
                      </div>
                      <div className="banner-stat">
                        <strong>
                          {overview.season.end
                            ? Math.max(
                                0,
                                Math.ceil(
                                  (new Date(overview.season.end).getTime() -
                                    now) /
                                    86400000,
                                ),
                              )
                            : "—"}
                        </strong>
                        <span>days remaining</span>
                      </div>
                      <button
                        className="button primary"
                        onClick={() => play(game, "ranked")}
                      >
                        Play ranked
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    <div className="rank-tiers">
                      {RANKS.map((r, i) => (
                        <div key={r.name}>
                          <Shield
                            size={20}
                            style={{ opacity: 0.4 + i * 0.1 }}
                          />
                          <strong>{r.name}</strong>
                          <span>{r.min}+ RP</span>
                        </div>
                      ))}
                    </div>
                    <section className="panel full">
                      <div className="panel-heading">
                        <h2>Global standings</h2>
                        <label className="search-box">
                          <Search size={16} />
                          <input
                            aria-label="Search players"
                            placeholder="Find a player"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                      </div>
                      {boardTable(
                        board.filter((p) =>
                          p.username
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        ),
                      )}
                    </section>
                    <p className="small muted footnote">
                      Ratings start at 1,000. Ranked results use Elo; casual and
                      friend matches do not change your rating. Seasons reset
                      quarterly, while match history stays on your profile.
                    </p>
                  </>
                )}
                {view === "tournaments" && (
                  <>
                    <PageHeading
                      eyebrow="RAISE THE STAKES"
                      title="Four players. One champion."
                      description="Create a four-player knockout, gather your rivals and settle it in the arena."
                      action={
                        <button
                          className="button primary"
                          onClick={() =>
                            user
                              ? setCreateTournament(true)
                              : setAuth("register")
                          }
                        >
                          <Plus size={17} />
                          Create tournament
                        </button>
                      }
                    />
                    <TournamentInvitations
                      state={platform.state}
                      command={command}
                      notify={notify}
                    />
                    <div className="tournament-explainer">
                      <span>
                        01 <b>Gather your four</b>
                      </span>
                      <ArrowRight size={18} />
                      <span>
                        02 <b>Win the semifinals</b>
                      </span>
                      <ArrowRight size={18} />
                      <span>
                        03 <b>Take the title</b>
                      </span>
                    </div>
                    {tournaments.length ? (
                      <div className="tournament-grid">
                        {tournaments.map((t) => (
                          <article className="tournament-card" key={t.id}>
                            <div className="tournament-top">
                              <span
                                className={`status-pill ${t.status === "open" ? "accent" : ""}`}
                              >
                                {t.status}
                              </span>
                              <span>{GAME_INFO[t.game].name}</span>
                            </div>
                            <h2>{t.name}</h2>
                            <p className="muted small">
                              Hosted by {t.host} · {t.entrants.length}/4 players
                            </p>
                            <div className="entrant-list">
                              {[0, 1, 2, 3].map((i) => (
                                <div key={i}>
                                  <span
                                    className="avatar small-avatar"
                                    style={{ color: t.entrants[i]?.accent }}
                                  >
                                    {t.entrants[i]?.username
                                      .slice(0, 2)
                                      .toUpperCase() || <Plus size={14} />}
                                  </span>
                                  <span>
                                    {t.entrants[i]?.username || "Open slot"}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {t.fixtures.length > 0 && (
                              <div className="bracket">
                                {t.fixtures.map((f) => (
                                  <div key={`${f.round}-${f.slot}`}>
                                    <span>
                                      {f.round === 1
                                        ? `SEMIFINAL ${f.slot + 1}`
                                        : "FINAL"}
                                    </span>
                                    <b>
                                      {f.name_a} <small>vs</small> {f.name_b}
                                    </b>
                                    <em>
                                      {f.winner
                                        ? `${f.winner} advances`
                                        : "In progress"}
                                    </em>
                                  </div>
                                ))}
                              </div>
                            )}
                            {t.winner && (
                              <div className="tournament-winner">
                                <Trophy size={18} />
                                {t.winner} takes the title
                              </div>
                            )}
                            {t.status === "open" &&
                              t.entrants.length < 4 &&
                              t.entrants.some((p) => p.id === user?.id) && (
                                <TournamentInviteButton
                                  tournament={t}
                                  social={social}
                                  command={command}
                                  notify={notify}
                                />
                              )}
                            {t.status === "open" && (
                              <div className="tournament-actions">
                                {t.entrants.some((p) => p.id === user?.id) ? (
                                  <>
                                    <span className="small muted">
                                      <Check size={14} />
                                      You’re in
                                    </span>
                                    {t.host_id === user?.id && (
                                      <button
                                        className="button primary compact"
                                        disabled={
                                          busy ||
                                          t.entrants.length !== 4 ||
                                          !connected
                                        }
                                        onClick={() =>
                                          void tournamentAction(t.id, "start")
                                        }
                                      >
                                        Start tournament
                                      </button>
                                    )}
                                    <button
                                      className="text-button muted"
                                      disabled={busy}
                                      onClick={() =>
                                        void tournamentAction(t.id, "leave")
                                      }
                                    >
                                      {t.host_id === user?.id
                                        ? "Cancel"
                                        : "Leave"}
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    className="button secondary"
                                    disabled={busy || t.entrants.length === 4}
                                    onClick={() =>
                                      void tournamentAction(t.id, "join")
                                    }
                                  >
                                    Join tournament
                                    <ArrowRight size={15} />
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="panel empty-state tall">
                        <Swords size={40} />
                        <h2>Make the first move.</h2>
                        <p>
                          No tournaments yet. Create one and bring three rivals.
                          <br />
                          All players must be signed in and online when the host
                          starts.
                        </p>
                        <button
                          className="button primary"
                          onClick={() =>
                            user
                              ? setCreateTournament(true)
                              : setAuth("register")
                          }
                        >
                          <Plus size={16} />
                          Create a tournament
                        </button>
                      </div>
                    )}
                  </>
                )}
                {view === "profile" && (
                  <>
                    {!user && !profileId ? (
                      gate()
                    ) : !profile ? (
                      <Loading />
                    ) : (
                      <>
                        <div
                          className={`profile-banner cosmetic-${profile.player.cosmetic || "graphite"}`}
                          style={
                            profile.player.banner
                              ? {
                                  backgroundImage: `url("${profile.player.banner}")`,
                                }
                              : undefined
                          }
                        >
                          <span>
                            DUELZONE / {profile.progression.title.toUpperCase()}
                          </span>
                        </div>
                        <div className="profile-hero">
                          <PlayerAvatar
                            player={profile.player}
                            className="profile-avatar"
                          />
                          <div>
                            <span className="eyebrow">DUELZONE PLAYER</span>
                            <h1>{profile.player.username}</h1>
                            <p>
                              {profile.player.bio ||
                                "Let the score do the talking."}
                            </p>
                          </div>
                          <span className="profile-rank">
                            <Shield size={25} />
                            {rankFor(profile.rating.rating).name}
                            <small>{profile.rating.rating} RP</small>
                          </span>
                          {profile.player.id === user?.id && (
                            <button
                              className="button secondary compact"
                              onClick={() => navigate("settings")}
                            >
                              Edit profile
                            </button>
                          )}
                        </div>
                        <ProfileExtras
                          onConnect={() =>
                            user
                              ? window.dispatchEvent(
                                  new CustomEvent("dz:friends", {
                                    detail: {
                                      target: profile.player.id,
                                      query: profile.player.username,
                                    },
                                  }),
                                )
                              : setAuth("login")
                          }
                          profile={profile}
                          own={profile.player.id === user?.id}
                          onProfile={showProfile}
                          notify={notify}
                        />
                        {profile.progression && (
                          <ProgressionPanel progress={profile.progression} />
                        )}
                        <div className="stat-grid">
                          {[
                            {
                              label: "MATCHES PLAYED",
                              value: profile.stats.played,
                            },
                            { label: "WINS", value: profile.stats.wins },
                            {
                              label: "WIN RATE",
                              value: `${profile.stats.played ? Math.round((profile.stats.wins / profile.stats.played) * 100) : 0}%`,
                            },
                            {
                              label: "LOSSES",
                              value:
                                profile.stats.played -
                                profile.stats.wins -
                                profile.stats.draws,
                            },
                          ].map((s) => (
                            <div className="stat-card" key={s.label}>
                              <span className="eyebrow">{s.label}</span>
                              <strong>{s.value}</strong>
                            </div>
                          ))}
                        </div>
                        <div className="section-heading">
                          <h2>Your game. By the numbers.</h2>
                          <span className="muted small">
                            Personal records · total match points
                          </span>
                        </div>
                        <div className="record-grid">
                          {games.map((g) => {
                            const record = profile.records.find(
                              (r) => r.game === g,
                            );
                            const Icon = gameIcons[g];
                            return (
                              <div className="record-card" key={g}>
                                <Icon
                                  style={{ color: GAME_INFO[g].color }}
                                  size={24}
                                />
                                <h3>{GAME_INFO[g].name}</h3>
                                <strong>
                                  {record
                                    ? (g === "showdown"
                                        ? record.best / 2
                                        : record.best
                                      ).toLocaleString()
                                    : "—"}
                                </strong>
                                <span>PERSONAL BEST</span>
                                <p>
                                  {record
                                    ? `${record.played} matches · ${record.wins} wins`
                                    : "Your first record is waiting."}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                        <HistoryTable profile={profile} />
                      </>
                    )}
                  </>
                )}
                {view === "history" && (
                  <>
                    <PageHeading
                      eyebrow="EVERY MATCH TELLS A STORY"
                      title="Your track record."
                      description="Wins, lessons and the numbers behind your progress."
                    />
                    {!user ? (
                      gate()
                    ) : ownProfile ? (
                      <HistoryTable profile={ownProfile} />
                    ) : (
                      <Loading />
                    )}
                  </>
                )}
                {view === "settings" && (
                  <>
                    <PageHeading
                      eyebrow="MAKE IT YOURS"
                      title="Your identity. Your arena."
                      description="Customize how you show up and keep your account secure."
                    />
                    {!user ? (
                      gate()
                    ) : (
                      <>
                        <ProfileMediaEditor
                          user={user}
                          profile={ownProfile}
                          onSave={(p) => {
                            setUser(p);
                            setTick((t) => t + 1);
                          }}
                          notify={notify}
                        />
                        <SettingsForm
                          user={user}
                          onSave={(p) => {
                            setUser(p);
                            notify("Profile updated.");
                          }}
                          onPassword={() => {
                            setTick((t) => t + 1);
                            socket.current?.connect();
                            notify(
                              "Password updated. Other sessions have been signed out.",
                            );
                          }}
                          onLogout={() => void logout()}
                          notify={notify}
                        />
                      </>
                    )}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        {auth && (
          <Modal
            title={auth === "register" ? "Enter the arena." : "Welcome back."}
            onClose={() => {
              setAuth(null);
              setPending(null);
            }}
          >
            <AuthForm
              mode={auth}
              onSwitch={() => setAuth(auth === "login" ? "register" : "login")}
              onSuccess={(p) => {
                setUser(p);
                if (!pendingRef.current) navigate("dashboard");
                setAuth(null);
                setTick((t) => t + 1);
              }}
            />
          </Modal>
        )}
        {practice && (
          <Modal
            title={`${GAME_INFO[practice].name} / Warm-up`}
            wide
            onClose={() => setPractice(null)}
          >
            <Practice game={practice} onClose={() => setPractice(null)} />
          </Modal>
        )}
        {help && (
          <Modal title="Find your edge." wide onClose={() => setHelp(false)}>
            <p className="modal-description">
              Fifteen disciplines. Find a real rival, invite a friend, or
              practise against a clearly labelled AI opponent.
            </p>
            <div className="rules-list">
              {games.map((g) => {
                const Icon = gameIcons[g];
                return (
                  <div key={g}>
                    <Icon size={25} style={{ color: GAME_INFO[g].color }} />
                    <div>
                      <h3>
                        {GAME_INFO[g].name}
                        <span>
                          {GAME_INFO[g].rounds}{" "}
                          {GAME_INFO[g].rounds === 1 ? "round" : "rounds"}
                        </span>
                      </h3>
                      <p>{GAME_INFO[g].description}</p>
                      <p className="small muted">
                        {g === "reaction"
                          ? "Space or tap after green. Early attempts score zero. Faster valid reactions earn more points."
                          : g === "aim"
                            ? "One shot per target. Closer to the center and faster hits score higher. A miss earns zero."
                            : g === "speed"
                              ? "Use keys 1–4 or the color buttons. Match the INK color, ignoring the written word."
                              : g === "precision"
                                ? "Space or tap to stop the marker. The closer to center, the higher the score."
                                : GAME_INFO[g].keys}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="info-note">
              <Shield size={20} />
              <p>
                Ranked matches change your Elo rating. Casual and friend matches
                save stats without changing rank. Scores use server-received
                inputs; connection latency can affect timing. Disconnecting for
                20 seconds forfeits the match.
              </p>
            </div>
            <button className="button primary" onClick={() => setHelp(false)}>
              Got it. Let’s play.
              <ArrowRight size={16} />
            </button>
          </Modal>
        )}
        {aiPicker && !match && (
          <Modal
            title="Find your sparring partner."
            onClose={() => setAiPicker(false)}
          >
            <AIPicker
              initial={game}
              busy={busy}
              onPlay={(selected, difficulty) => {
                const action: Pending = { ai: selected, difficulty };
                if (!user) {
                  setAiPicker(false);
                  setPending(action);
                  setAuth("register");
                } else void begin(action);
              }}
            />
          </Modal>
        )}
        {queue && !match && (
          <Modal
            title={
              queue.invite
                ? "Your rival is one link away."
                : "Finding your next rival."
            }
            onClose={() => void leaveQueue()}
          >
            <div className="matchmaking">
              <div className="radar">
                <i />
                <i />
                <i />
                <Crosshair size={32} />
              </div>
              <span className="eyebrow">
                {queue.game === "any"
                  ? "QUICK MATCH · ALL DISCIPLINES"
                  : GAME_INFO[queue.game].name}
              </span>
              {queue.game === "any" && (
                <div
                  className="queue-disciplines"
                  aria-label="Searching all game modes"
                >
                  {featuredGames.map((g) => (
                    <span key={g}>{GAME_INFO[g].name}</span>
                  ))}
                </div>
              )}
              <h3>{queue.invite ? "Invite a friend." : "Stay sharp."}</h3>
              <p>
                {queue.invite
                  ? "Share this link. The match starts when your friend joins."
                  : queue.game === "any"
                    ? "Searching for a real player across all games. We randomly choose a compatible discipline when you are paired."
                    : "Waiting for a real opponent. Your match starts as soon as another player joins this queue."}
              </p>
              {queue.invite ? (
                <>
                  <label className="invite-field">
                    <span>PRIVATE INVITE · VALID FOR 15 MINUTES</span>
                    <input
                      readOnly
                      value={queue.invite}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <button
                    className="button primary"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(queue.invite!)
                        .then(() => notify("Invite link copied."))
                        .catch(() =>
                          notify(
                            "Select the invite link and copy it manually.",
                          ),
                        )
                    }
                  >
                    <Copy size={16} />
                    Copy invite link
                  </button>
                </>
              ) : (
                <>
                  <div className="queue-time">
                    {String(
                      Math.floor(Math.max(0, now - queue.at) / 60000),
                    ).padStart(2, "0")}
                    :
                    {String(
                      Math.floor(Math.max(0, now - queue.at) / 1000) % 60,
                    ).padStart(2, "0")}
                  </div>
                  <span className="small muted">
                    {overview.online} online · {overview.queued} in matchmaking
                  </span>
                  <button
                    className="text-button accent"
                    onClick={() =>
                      void begin({
                        game: queue.game === "any" ? game : queue.game,
                        mode: "friend",
                      })
                    }
                  >
                    Challenge a friend instead
                    <ArrowRight size={15} />
                  </button>
                </>
              )}
              <button
                className="text-button muted"
                onClick={() => void leaveQueue()}
              >
                Cancel {queue.invite ? "invite" : "search"}
              </button>
            </div>
          </Modal>
        )}
        {match && user && (
          <Arena
            state={match}
            userId={user.id}
            connected={connected}
            onAction={(a) => {
              if (!socket.current?.connected) return;
              if (a.dx !== undefined) socket.current.volatile.emit("action", a);
              else socket.current.emit("action", a);
            }}
            onLeave={() =>
              void command("match:leave").catch((e) => notify(e.message))
            }
            onRematch={() =>
              void command("rematch", { id: match.id }).catch((e) =>
                notify(e.message),
              )
            }
            onClose={() => {
              setMatch(null);
              setTick((t) => t + 1);
            }}
          />
        )}
        {createTournament && (
          <Modal
            title="Create your tournament."
            onClose={() => setCreateTournament(false)}
          >
            <TournamentForm
              onSuccess={() => {
                setCreateTournament(false);
                setTick((t) => t + 1);
              }}
            />
          </Modal>
        )}
        {user && (
          <SocialPanel
            user={user}
            socket={socket.current}
            connected={connected}
            command={command}
            onProfile={showProfile}
            onState={setSocial}
            matchId={match?.phase !== "finished" ? match?.id : undefined}
          />
        )}
        <AnimatePresence>
          {toast && (
            <motion.div
              className="toast"
              role="status"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              <Info size={18} />
              <span>{toast}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setToast("")}
              >
                <X size={15} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Loading() {
  return (
    <div className="empty-state tall">
      <div className="loading-spinner" />
      <p>Loading your arena…</p>
    </div>
  );
}
function AuthForm({
  mode,
  onSwitch,
  onSuccess,
}: {
  mode: "login" | "register";
  onSwitch: () => void;
  onSuccess: (p: Player) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api(`/auth/${mode}`, data);
      onSuccess(result.player);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <p className="modal-description">
        {mode === "register"
          ? "Your skill. Your identity. Your place on the leaderboard."
          : "Your next opponent is waiting."}
      </p>
      {mode === "register" && (
        <label>
          Player name
          <input
            name="username"
            placeholder="Your in-game name"
            required
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
            autoComplete="username"
          />
          <small>3–20 letters, numbers or underscores.</small>
        </label>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          autoComplete="email"
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          placeholder={
            mode === "register" ? "At least 12 characters" : "Your password"
          }
          required
          minLength={mode === "register" ? 12 : 1}
          maxLength={128}
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
        />
      </label>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <button className="button primary full-width" disabled={busy}>
        {busy
          ? "One moment…"
          : mode === "register"
            ? "Create player account"
            : "Sign in"}
        <ArrowRight size={16} />
      </button>
      <p className="auth-switch">
        {mode === "register" ? "Already have an account?" : "New to DuelZone?"}
        <button
          type="button"
          onClick={() => {
            setError("");
            onSwitch();
          }}
        >
          {mode === "register" ? "Sign in" : "Join the arena"}
        </button>
      </p>
      <p className="privacy-note">
        <Shield size={13} />
        Your email stays private. Your player name, match history and stats are
        public.
      </p>
    </form>
  );
}
function TournamentForm({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(
            "/tournaments",
            Object.fromEntries(new FormData(e.currentTarget)),
          );
          onSuccess();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="modal-description">
        Four players. Two semifinals. One final. You join automatically as the
        host.
      </p>
      <label>
        Tournament name
        <input
          name="name"
          required
          minLength={3}
          maxLength={48}
          placeholder="Friday Night Face-off"
        />
      </label>
      <label>
        Game
        <select name="game">
          {games.map((g) => (
            <option key={g} value={g}>
              {GAME_INFO[g].name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="info-note">
        <Users size={20} />
        <p>
          Ask three friends to open DuelZone and join from Tournaments. All four
          players must be online to start.
        </p>
      </div>
      <button className="button primary" disabled={busy}>
        {busy ? "Creating…" : "Create tournament"}
        <ArrowRight size={16} />
      </button>
    </form>
  );
}
function HistoryTable({ profile }: { profile: Profile }) {
  return (
    <section className="panel full history-panel">
      <div className="panel-heading">
        <h2>
          <History size={17} />
          Recent matches
        </h2>
        <span className="small muted">Latest 50 matches</span>
      </div>
      {profile.history.length ? (
        <div className="table-scroll">
          <table className="history-table">
            <thead>
              <tr>
                <th>RESULT</th>
                <th>GAME</th>
                <th>OPPONENT</th>
                <th>SCORE</th>
                <th>RATING</th>
                <th>PLAYED</th>
              </tr>
            </thead>
            <tbody>
              {profile.history.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span
                      className={`result-tag ${m.status === "abandoned" ? "draw" : m.winner_id === profile.player.id ? "win" : m.winner_id ? "loss" : "draw"}`}
                    >
                      {m.status === "abandoned"
                        ? "VOID"
                        : m.winner_id === profile.player.id
                          ? "WIN"
                          : m.winner_id
                            ? "LOSS"
                            : "DRAW"}
                    </span>
                  </td>
                  <td>
                    {GAME_INFO[m.game].name}
                    <small className="table-sub">{m.mode}</small>
                    {m.game === "showdown" && m.details?.length ? (
                      <details className="history-series">
                        <summary>Round breakdown</summary>
                        {m.details.map((r, i) => (
                          <div key={i}>
                            {i + 1}. {GAME_INFO[r.game].name} ·{" "}
                            {Object.values(r.scores).join(" : ")}
                          </div>
                        ))}
                      </details>
                    ) : null}
                  </td>
                  <td>{m.opponent}</td>
                  <td className="mono">
                    {(m.game === "showdown"
                      ? m.score / 2
                      : m.score
                    ).toLocaleString()}{" "}
                    <span className="muted">
                      /{" "}
                      {(m.game === "showdown"
                        ? m.opponent_score / 2
                        : m.opponent_score
                      ).toLocaleString()}
                    </span>
                  </td>
                  <td className={m.rating_change > 0 ? "accent" : "muted"}>
                    {m.mode === "ranked"
                      ? `${m.rating_change > 0 ? "+" : ""}${m.rating_change}`
                      : "—"}
                  </td>
                  <td className="muted small">
                    {new Date(m.ended_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Activity size={30} />
          <h3>A clean slate. Endless possibilities.</h3>
          <p>Your completed matches will appear here.</p>
        </div>
      )}
    </section>
  );
}
function SettingsForm({
  user,
  onSave,
  onPassword,
  onLogout,
  notify,
}: {
  user: Player;
  onSave: (p: Player) => void;
  onPassword: () => void;
  onLogout: () => void;
  notify: (s: string) => void;
}) {
  const [accent, setAccent] = useState(user.accent),
    [busy, setBusy] = useState(false);
  return (
    <div className="settings-grid">
      <form
        className="panel settings-form form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const result = await api(
              "/profile",
              { bio: new FormData(e.currentTarget).get("bio"), accent },
              "PATCH",
            );
            onSave(result.player);
          } catch (e) {
            notify((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Player identity</h2>
        <div className="settings-avatar">
          <span
            className="avatar profile-avatar"
            style={{ color: accent, background: `${accent}15` }}
          >
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{user.username}</strong>
            <p className="small muted">Choose your signature color.</p>
          </div>
        </div>
        <fieldset className="accent-picker">
          <legend>Profile color</legend>
          {["#c8f36a", "#a5bce9", "#e8b39a", "#c2b4df", "#eeeeee"].map(
            (c, i) => (
              <button
                key={c}
                type="button"
                style={{ background: c }}
                aria-label={["Lime", "Blue", "Coral", "Purple", "White"][i]}
                aria-pressed={accent === c}
                onClick={() => setAccent(c)}
              >
                {accent === c && <Check size={18} />}
              </button>
            ),
          )}
        </fieldset>
        <label>
          Bio
          <textarea
            name="bio"
            defaultValue={user.bio}
            maxLength={160}
            placeholder="A few words about your competitive side."
            rows={3}
          />
          <small>Up to 160 characters. Visible on your public profile.</small>
        </label>
        <button className="button primary" disabled={busy}>
          Save profile
          <Check size={16} />
        </button>
      </form>
      <div>
        <form
          className="panel settings-form form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const form = e.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            try {
              await api("/auth/password", data);
              form.reset();
              onPassword();
            } catch (e) {
              notify((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2>Account security</h2>
          <label>
            Current password
            <input
              type="password"
              name="current"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
            />
            <small>At least 12 characters.</small>
          </label>
          <button className="button secondary" disabled={busy}>
            Update password
            <Shield size={16} />
          </button>
        </form>
        <button className="button danger logout-button" onClick={onLogout}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}
