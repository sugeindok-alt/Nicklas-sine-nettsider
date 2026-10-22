"use client";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Pause,
  Play,
  Swords,
  Users,
  Zap,
} from "lucide-react";
import { GAME_INFO, type Game } from "@/lib/shared";
import { GameplayPreview } from "./gameplay-preview";

export function ArenaShowcase({
  quick,
  challenge,
  ai,
  practice,
  busy = false,
  compact = false,
}: {
  quick: () => void;
  challenge: () => void;
  ai?: () => void;
  practice: (game: Game) => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const [game, setGame] = useState<Game>("knockout"),
    [paused, setPaused] = useState(false);
  const Heading = compact ? "h2" : "h1";
  return (
    <section
      className={`arena-showcase ${compact ? "showcase-compact" : ""}`}
      aria-label="Discover DuelZone"
    >
      <div className="showcase-copy">
        <span className="section-index">
          <span /> Built for the one-on-one
        </span>
        <Heading className="showcase-title">
          {compact ? (
            <>
              Ready for
              <br /> another <em>round?</em>
            </>
          ) : (
            <>
              Your next
              <br /> rivalry <em>starts here.</em>
            </>
          )}
        </Heading>
        <p>
          Fifteen ways to compete. One opponent.
          <br /> Find your game. Make it yours.
        </p>
        <button
          className="button primary showcase-quick"
          onClick={quick}
          disabled={busy}
        >
          <Zap size={18} /> Quick Match <ArrowUpRight size={20} />
        </button>
        <div className="showcase-alternatives">
          <button onClick={challenge}>
            <Users size={16} /> Challenge a friend
          </button>
          {ai && (
            <button onClick={ai}>
              <Bot size={16} /> Play vs AI
            </button>
          )}
        </div>
        <div className="showcase-details">
          <span>Free to play</span>
          <span>Real-time multiplayer</span>
        </div>
      </div>
      <div className="showcase-stage">
        <div className="stage-heading">
          <span>
            <Swords size={14} /> The arena
          </span>
          <span>AI gameplay preview</span>
          <button
            className="icon-button"
            onClick={() => setPaused(!paused)}
            aria-label={
              paused ? "Resume gameplay preview" : "Pause gameplay preview"
            }
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
        <div className="stage-screen">
          <GameplayPreview game={game} animate={!paused} />
          <span className="stage-corner">01 / 02</span>
        </div>
        <div className="stage-caption">
          <div>
            <span>Featured discipline</span>
            <h2>{GAME_INFO[game].name}</h2>
          </div>
          <button className="stage-try" onClick={() => practice(game)}>
            Try it <ArrowUpRight size={20} />
          </button>
        </div>
        <div className="stage-tabs" aria-label="Featured gameplay">
          {(["knockout", "ball", "grapple"] as Game[]).map((g, i) => (
            <button
              key={g}
              aria-pressed={g === game}
              onClick={() => setGame(g)}
            >
              <span>0{i + 1}</span>
              {GAME_INFO[g].short}
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
