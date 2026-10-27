"use client";
import { useState } from "react";
import { Bot, ArrowRight, Check } from "lucide-react";
import { frontierGames, isFrontier } from "@/lib/frontier";
import { games, featuredGames, GAME_INFO, type Game } from "@/lib/shared";
import { difficulties, type Difficulty } from "@/lib/bot";
const descriptions = {
  easy: "Time to find your rhythm.",
  medium: "A balanced sparring partner.",
  hard: "Fast reactions. Fewer openings.",
  expert: "Precise, relentless competition.",
};
export function AIPicker({
  initial,
  onPlay,
  busy,
}: {
  initial: Game;
  onPlay: (game: Game, difficulty: Difficulty) => void;
  busy: boolean;
}) {
  const [game, setGame] = useState<Game>(initial);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  return (
    <div className="ai-picker">
      <p className="muted">
        An AI sparring partner that moves, aims and solves the same challenges
        as you. No waiting. Completed sessions are saved in Training. No ranked
        points or mastery XP.
      </p>
      <label className="ai-game-label">
        Choose your discipline
        <select value={game} onChange={(e) => setGame(e.target.value as Game)}>
          {games.map((g) => (
            <option value={g} key={g}>
              {GAME_INFO[g].name}
            </option>
          ))}
        </select>
      </label>
      <div className="difficulty-grid" role="group" aria-label="AI difficulty">
        {difficulties.map((d) => (
          <button
            className={difficulty === d ? "selected" : ""}
            aria-pressed={difficulty === d}
            onClick={() => setDifficulty(d)}
            key={d}
          >
            <span>
              <Bot size={17} />
              <strong>{d}</strong>
              {difficulty === d && <Check size={15} />}
            </span>
            <small>{descriptions[d]}</small>
          </button>
        ))}
      </div>
      <button
        className="button primary"
        disabled={busy}
        onClick={() => onPlay(game, difficulty)}
      >
        Play vs AI <ArrowRight size={16} />
      </button>
    </div>
  );
}
