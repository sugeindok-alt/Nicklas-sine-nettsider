"use client";
import { useState } from "react";
import {
  Search,
  Star,
  ArrowUpRight,
  SlidersHorizontal,
  Swords,
  Play,
  Shield,
} from "lucide-react";
import { GAME_INFO, games, type Game } from "@/lib/shared";
import {
  categories,
  category,
  duration,
  type Preferences,
} from "@/lib/platform";
import { gameIcons } from "./game-art";
import type { Profile } from "./duelzone";
import { GameplayPreview } from "./gameplay-preview";
export function GameLibrary({
  selected,
  onSelect,
  onPractice,
  onPlay,
  onChallenge,
  mode,
  onMode,
  preferences,
  save,
  onLogin,
  profile,
  ready,
}: {
  selected: Game;
  onSelect: (g: Game) => void;
  onPractice: (g: Game) => void;
  onPlay: (g: Game) => void;
  onChallenge: (g: Game) => void;
  mode: "ranked" | "casual";
  onMode: (mode: "ranked" | "casual") => void;
  preferences: Preferences;
  save: (p: Preferences) => Promise<void>;
  onLogin: () => void;
  profile: Profile | null;
  ready: boolean;
}) {
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState("All games"),
    [filter, setFilter] = useState("all"),
    [options, setOptions] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<Game | null>(null),
    [details, setDetails] = useState<Game | null>(null);
  const recent = [
    ...new Set(
      profile?.history
        .filter((m) => m.status === "finished")
        .map((m) => m.game) || [],
    ),
  ].slice(0, 6);
  const list = games.filter(
    (g) =>
      (group === "All games" || category[g] === group) &&
      GAME_INFO[g].name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "favorites" && preferences.favorites.includes(g)) ||
        (filter === "recent" && recent.includes(g))),
  );
  async function toggle(g: Game, key: "favorites" | "excluded") {
    if (!profile) {
      onLogin();
      return;
    }
    const next = preferences[key].includes(g)
      ? preferences[key].filter((x) => x !== g)
      : [...preferences[key], g];
    if (key === "excluded" && next.length === games.length) {
      setError("Keep at least one game in Quick Match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save({ ...preferences, [key]: next });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="game-section game-library" aria-label="Game library">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Choose your discipline</p>
          <h2>
            The game library <span className="count-badge">{games.length}</span>
          </h2>
        </div>
        <button
          className="text-button"
          onClick={() => setOptions(!options)}
          aria-expanded={options}
        >
          <SlidersHorizontal size={16} /> Quick Match preferences
        </button>
      </div>
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={17} />
          <input
            aria-label="Search games"
            placeholder="Find your game…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Game collection"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All disciplines</option>
          <option value="favorites">Your favorites</option>
          <option value="recent">Recently played</option>
        </select>
        <div className="mode-toggle" aria-label="Match type">
          <button
            aria-pressed={mode === "ranked"}
            className={mode === "ranked" ? "active" : ""}
            onClick={() => onMode("ranked")}
          >
            <Shield size={14} />
            Ranked
          </button>
          <button
            aria-pressed={mode === "casual"}
            className={mode === "casual" ? "active" : ""}
            onClick={() => onMode("casual")}
          >
            Casual
          </button>
        </div>
      </div>
      <div className="library-categories" aria-label="Game categories">
        {categories.map((c) => (
          <button
            key={c}
            aria-pressed={group === c}
            onClick={() => setGroup(c)}
          >
            {c}
          </button>
        ))}
      </div>
      {options && (
        <div className="quick-preferences">
          <h3>Your Quick Match pool</h3>
          <p>
            Only these modes can be selected when you search for a real
            opponent. Changes apply to your next search.
          </p>
          <div>
            {games.map((g) => (
              <label key={g}>
                <input
                  type="checkbox"
                  checked={!preferences.excluded.includes(g)}
                  disabled={busy || (!!profile && !ready)}
                  onChange={() => void toggle(g, "excluded")}
                />
                {GAME_INFO[g].short}
              </label>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div
        className={`game-grid discovery-grid ${!query && group === "All games" && filter === "all" ? "has-featured" : ""}`}
      >
        {list.map((g, i) => {
          const Icon = gameIcons[g],
            record = profile?.records.find((r) => r.game === g);
          return (
            <article
              key={g}
              className={`game-card ${selected === g ? "selected" : ""} ${i < 2 ? "featured-card" : ""}`}
              onMouseEnter={() => setPreview(g)}
              onMouseLeave={() => setPreview(null)}
              onFocus={() => setPreview(g)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget))
                  setPreview(null);
              }}
              style={
                { "--game-color": GAME_INFO[g].color } as React.CSSProperties
              }
            >
              <button
                className="game-preview"
                onClick={() => {
                  onSelect(g);
                  setDetails(details === g ? null : g);
                }}
                aria-label={`Details for ${GAME_INFO[g].name}`}
                aria-expanded={details === g}
              >
                <GameplayPreview game={g} animate={preview === g} />
                <span className="preview-label">
                  Explore game <ArrowUpRight size={14} />
                </span>
                <span className="game-number">
                  {String(games.indexOf(g) + 1).padStart(2, "0")}
                </span>
              </button>
              <div className="game-card-info">
                <div className="game-meta">
                  <Icon size={14} />
                  <span>{category[g]}</span>
                  <span>1V1</span>
                </div>
                <div className="library-game-name">
                  <h3>{GAME_INFO[g].name}</h3>
                  <button
                    className="icon-button favorite-game"
                    aria-label={`${preferences.favorites.includes(g) ? "Unfavorite" : "Favorite"} ${GAME_INFO[g].name}`}
                    aria-pressed={preferences.favorites.includes(g)}
                    disabled={busy || (!!profile && !ready)}
                    onClick={() => void toggle(g, "favorites")}
                  >
                    <Star
                      size={17}
                      fill={
                        preferences.favorites.includes(g)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                </div>
                <p>{duration(g)} · 2 players</p>
                <p className="game-short-description">
                  {GAME_INFO[g].description.split(". ")[0]}.
                </p>
                {record && (
                  <small className="personal-record">
                    {record.wins} wins / {record.played} played · Best{" "}
                    {g === "showdown" ? record.best / 2 : record.best}
                  </small>
                )}
                {details === g && (
                  <div className="game-rules">
                    <p>{GAME_INFO[g].description}</p>
                    <span>{GAME_INFO[g].keys.toLowerCase()}</span>
                  </div>
                )}
                <div className="game-actions">
                  <button
                    className="button primary compact"
                    onClick={() => onPlay(g)}
                    aria-label={`Play ${GAME_INFO[g].name}`}
                  >
                    <Play size={13} fill="currentColor" />
                    Play
                  </button>
                  <button
                    className="text-button"
                    onClick={() => onPractice(g)}
                    aria-label={`Practice ${GAME_INFO[g].name}`}
                  >
                    Practice
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => onChallenge(g)}
                    aria-label={`Challenge a friend to ${GAME_INFO[g].name}`}
                    title="Challenge a friend"
                  >
                    <Swords size={17} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!list.length && (
        <div className="empty-state">
          <Search size={28} />
          <h3>
            {filter === "favorites"
              ? "Build your shortlist."
              : filter === "recent"
                ? "Your next match starts the list."
                : "No games match those filters."}
          </h3>
          <p>
            {filter === "favorites"
              ? "Star a game to keep it close."
              : "Try another category or search."}
          </p>
          <button
            className="text-button"
            onClick={() => {
              setFilter("all");
              setGroup("All games");
              setQuery("");
            }}
          >
            Show all games
          </button>
        </div>
      )}
    </section>
  );
}
