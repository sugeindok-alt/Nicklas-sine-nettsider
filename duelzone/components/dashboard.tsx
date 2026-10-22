"use client";
import {
  ArrowUpRight,
  ArrowRight,
  Zap,
  Swords,
  Users,
  Trophy,
  Star,
} from "lucide-react";
import { GAME_INFO, games, rankFor, RANKS, type Game } from "@/lib/shared";
import { ACHIEVEMENTS } from "@/lib/progression";
import type { SocialState } from "@/lib/social";
import type { Preferences } from "@/lib/platform";
import type { Profile, Tournament } from "./duelzone";
import { openFriends, type Command } from "./platform-center";
import { ProgressionPanel } from "./progression";
import GameArt from "./game-art";
import { RankCrest } from "./rank-crest";
import { ArenaShowcase } from "./arena-showcase";
export function Dashboard({
  profile,
  social,
  tournaments,
  preferences,
  play,
  practice,
  navigate,
  command,
  notify,
}: {
  profile: Profile;
  social: SocialState | null;
  tournaments: Tournament[];
  preferences: Preferences;
  play: (g: Game | "any") => void;
  practice: (g: Game) => void;
  navigate: (v: "arena" | "profile" | "history" | "tournaments") => void;
  command: Command;
  notify: (s: string) => void;
}) {
  const p = profile.player,
    rank = rankFor(profile.rating.rating),
    next = RANKS.find((r) => r.min > profile.rating.rating),
    online =
      social?.friends.filter((f) =>
        ["online", "away", "in-match"].includes(f.presence),
      ) || [],
    pending =
      social?.challenges.filter(
        (c) =>
          c.to_id === p.id &&
          c.status === "pending" &&
          Date.parse(c.expires_at) > Date.now(),
      ) || [],
    recommended = [
      ...preferences.favorites,
      ...games.filter((g) => !profile.records.some((r) => r.game === g)),
      ...games,
    ]
      .filter((g, i, a) => a.indexOf(g) === i)
      .slice(0, 3),
    recent = profile.history.filter((m) => m.status === "finished").slice(0, 4),
    earned = profile.progression.achievements.slice(-3).reverse();
  async function respond(id: string, accept: boolean) {
    try {
      await command("social:challenge:respond", { challengeId: id, accept });
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <div className="dashboard">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Your arena</p>
          <h1>Welcome back, {p.username}.</h1>
        </div>
        <span className="subtle-tag">
          Level {profile.progression.level} / {profile.progression.title}
        </span>
      </div>
      <section className="dashboard-hero">
        <ArenaShowcase
          compact
          quick={() => play("any")}
          challenge={() => openFriends()}
          practice={practice}
        />
        <button className="dashboard-rank" onClick={() => navigate("profile")}>
          <RankCrest rating={profile.rating.rating} />
          <span>{rank.name}</span>
          <strong>
            {profile.rating.rating}
            <small> RATING POINTS</small>
          </strong>
          <div className="xp-track">
            <span
              style={{
                width: `${next ? Math.min(100, ((profile.rating.rating - rank.min) / (next.min - rank.min)) * 100) : 100}%`,
              }}
            />
          </div>
          <p>
            {next
              ? `${next.min - profile.rating.rating} RP to ${next.name}`
              : "Champion rank"}
          </p>
          <div className="dashboard-numbers">
            <span>
              <b>{profile.stats.wins}</b> WINS
            </span>
            <span>
              <b>
                {profile.stats.played
                  ? Math.round(
                      (profile.stats.wins / profile.stats.played) * 100,
                    )
                  : 0}
                %
              </b>{" "}
              WIN RATE
            </span>
            <span>
              <b>{profile.stats.played}</b> DUELS
            </span>
          </div>
        </button>
      </section>
      {pending.length > 0 && (
        <section className="dashboard-invites" aria-label="Pending challenges">
          {pending.map((c) => (
            <div key={c.id}>
              <Swords size={22} />
              <span>
                <b>{c.sender} is calling you out.</b>
                <small>
                  {GAME_INFO[c.game].name} · expires{" "}
                  {new Date(c.expires_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </span>
              <button
                className="button primary compact"
                onClick={() => void respond(c.id, true)}
              >
                Accept duel
              </button>
              <button
                className="text-button"
                onClick={() => void respond(c.id, false)}
              >
                Decline
              </button>
            </div>
          ))}
        </section>
      )}
      <div className="dashboard-columns">
        <section className="dashboard-recent">
          <div className="section-heading">
            <h2>Last time in the arena</h2>
            <button className="text-button" onClick={() => navigate("history")}>
              All matches <ArrowUpRight size={15} />
            </button>
          </div>
          {recent.length ? (
            recent.map((m) => (
              <button
                className="dashboard-match"
                key={m.id}
                onClick={() => navigate("history")}
              >
                <span
                  className={`result-tag ${m.winner_id === p.id ? "win" : m.winner_id ? "loss" : "draw"}`}
                >
                  {m.winner_id === p.id ? "W" : m.winner_id ? "L" : "D"}
                </span>
                <span>
                  <b>{GAME_INFO[m.game].name}</b>
                  <small>vs {m.opponent}</small>
                </span>
                <strong>
                  {m.game === "showdown" ? m.score / 2 : m.score}{" "}
                  <small>
                    {" "}
                    :{" "}
                    {m.game === "showdown"
                      ? m.opponent_score / 2
                      : m.opponent_score}
                  </small>
                </strong>
              </button>
            ))
          ) : (
            <div className="dashboard-empty">
              <Swords size={26} />
              <h3>Every rivalry starts somewhere.</h3>
              <p>Finish your first match to see your results here.</p>
            </div>
          )}
        </section>
        <section className="dashboard-circle">
          <div className="section-heading">
            <h2>
              Your circle <small>{online.length} online</small>
            </h2>
            <button
              className="icon-button"
              aria-label="Open friends sidebar"
              onClick={() => openFriends()}
            >
              <Users size={18} />
            </button>
          </div>
          {online.length ? (
            online.slice(0, 6).map((f) => (
              <button
                key={f.id}
                className="dashboard-friend"
                onClick={() => openFriends(f.id)}
              >
                <span className="avatar" style={{ color: f.accent }}>
                  {f.username.slice(0, 2)}
                </span>
                <span>
                  <b>{f.username}</b>
                  <small>
                    {f.game
                      ? `Playing ${GAME_INFO[f.game].short}`
                      : f.presence === "away"
                        ? "Away"
                        : "Ready for a rival"}
                  </small>
                </span>
                <i className={`presence-dot ${f.presence}`} />
              </button>
            ))
          ) : (
            <div className="dashboard-empty">
              <p>Your friends will appear here when they connect.</p>
              <button className="text-button" onClick={() => openFriends()}>
                Find your friends <ArrowRight size={14} />
              </button>
            </div>
          )}
        </section>
      </div>
      <section className="dashboard-recommendations">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              {preferences.favorites.length
                ? "FROM YOUR SHORTLIST"
                : "EXPLORE SOMETHING NEW"}
            </p>
            <h2>Your next discipline</h2>
          </div>
          <button className="text-button" onClick={() => navigate("arena")}>
            Game library <ArrowRight size={14} />
          </button>
        </div>
        <div>
          {recommended.map((g) => (
            <button key={g} onClick={() => practice(g)}>
              <GameArt game={g} />
              <span>
                {GAME_INFO[g].name}
                <small>
                  {preferences.favorites.includes(g)
                    ? "Your favorite · Warm up"
                    : "Try the interactive warm-up"}
                </small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
      </section>
      <ProgressionPanel progress={profile.progression} compact />
      <div className="dashboard-columns">
        <section>
          <div className="section-heading">
            <h2>Open tournaments</h2>
            <button
              className="text-button"
              onClick={() => navigate("tournaments")}
            >
              View brackets <ArrowRight size={15} />
            </button>
          </div>
          {tournaments
            .filter((t) => t.status === "open")
            .slice(0, 3)
            .map((t) => (
              <button
                className="dashboard-match"
                key={t.id}
                onClick={() => navigate("tournaments")}
              >
                <Trophy size={18} />
                <span>
                  <b>{t.name}</b>
                  <small>{GAME_INFO[t.game].name}</small>
                </span>
                <small>{t.entrants.length}/4 registered</small>
              </button>
            ))}
          {!tournaments.some((t) => t.status === "open") && (
            <p className="dashboard-empty">
              No open tournaments. Create one and invite your circle.
            </p>
          )}
        </section>
        <section>
          <div className="section-heading">
            <h2>Recent milestones</h2>
            <button className="text-button" onClick={() => navigate("profile")}>
              Your collection <ArrowRight size={15} />
            </button>
          </div>
          {earned.map((a) => (
            <div className="dashboard-match" key={a.id}>
              <Star size={20} />
              <span>
                <b>{ACHIEVEMENTS.find((x) => x.id === a.id)?.name || a.id}</b>
                <small>
                  Earned {new Date(a.earned_at).toLocaleDateString()}
                </small>
              </span>
            </div>
          ))}
          {!earned.length && (
            <p className="dashboard-empty">
              Your first completed win unlocks the Challenger title.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
