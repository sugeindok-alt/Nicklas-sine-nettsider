"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Target } from "lucide-react";
import { api } from "@/lib/client";
import { GAME_INFO, type Game } from "@/lib/shared";
import { difficulties, type Difficulty } from "@/lib/bot";
type TrainingData = {
  recent: {
    id: string;
    game: Game;
    difficulty: Difficulty;
    score: number;
    opponent_score: number;
    won: boolean;
    finished_at: string;
  }[];
  records: {
    game: Game;
    difficulty: Difficulty;
    attempts: number;
    best: number;
    average: number;
  }[];
};
const disciplines: { game: Game; skill: string; description: string }[] = [
  {
    game: "clash",
    skill: "Aim & accuracy",
    description: "Track moving targets, build combos and choose clean shots.",
  },
  {
    game: "reaction",
    skill: "Reaction",
    description:
      "Wait for the signal. Measure your response without false starts.",
  },
  {
    game: "precision",
    skill: "Precision & timing",
    description: "Stop the marker at centre and build a consistent rhythm.",
  },
  {
    game: "speed",
    skill: "Decision speed",
    description: "Read the ink while ignoring the word under time pressure.",
  },
  {
    game: "grapple",
    skill: "Movement",
    description: "Practise your swing, checkpoints and landing control.",
  },
  {
    game: "mind",
    skill: "Memory & patterns",
    description: "Keep sequences in mind and solve patterns against the clock.",
  },
];
export function TrainingHub({
  revision,
  play,
  connected,
}: {
  revision: number;
  play: (game: Game, difficulty: Difficulty) => void;
  connected: boolean;
}) {
  const [data, setData] = useState<TrainingData | null>(null),
    [difficulty, setDifficulty] = useState<Difficulty>("medium"),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<TrainingData>("/training")
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <section className="training-hub">
      <span className="eyebrow">TRAIN WITH INTENT</span>
      <h1 className="training-title">Find your edge.</h1>
      <p className="muted">
        Focused disciplines. Real AI sparring partners. Your completed scores
        saved separately from competitive rankings.
      </p>
      <div
        className="training-options"
        role="group"
        aria-label="Training difficulty"
      >
        {difficulties.map((d) => (
          <button
            key={d}
            className={`button ${difficulty === d ? "primary" : "secondary"} compact`}
            aria-pressed={difficulty === d}
            onClick={() => setDifficulty(d)}
          >
            {d}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="training-grid">
        {disciplines.map((d) => {
          const record = data?.records.find(
            (r) => r.game === d.game && r.difficulty === difficulty,
          );
          return (
            <article key={d.game} className="training-discipline">
              <Target size={25} style={{ color: GAME_INFO[d.game].color }} />
              <span className="eyebrow">{d.skill}</span>
              <h2>{GAME_INFO[d.game].name}</h2>
              <p>{d.description}</p>
              <div className="training-record">
                <span>
                  Personal best{" "}
                  <b>{record ? record.best.toLocaleString() : "—"}</b>
                </span>
                <small>
                  {record
                    ? `${record.attempts} completed · average ${record.average.toLocaleString()}`
                    : `No completed ${difficulty} sessions yet`}
                </small>
              </div>
              <button
                className="text-button"
                disabled={!connected}
                onClick={() => play(d.game, difficulty)}
              >
                Start session
                <ArrowRight size={16} />
              </button>
            </article>
          );
        })}
      </div>
      <section className="panel training-history">
        <div className="section-heading">
          <div>
            <span className="eyebrow">RECENT SESSIONS</span>
            <h2>See the work add up.</h2>
          </div>
        </div>
        {data?.recent.length ? (
          <div className="table-scroll">
            <table className="board-table">
              <thead>
                <tr>
                  <th>DISCIPLINE</th>
                  <th>DIFFICULTY</th>
                  <th>YOUR SCORE</th>
                  <th>AI SCORE</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{GAME_INFO[r.game].name}</td>
                    <td>{r.difficulty}</td>
                    <td className="mono bright">{r.score}</td>
                    <td>{r.opponent_score}</td>
                    <td>{new Date(r.finished_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <Target size={28} />
            <h3>Your next session is the starting point.</h3>
            <p>
              Only completed sessions are saved. Leaving early does not create a
              record.
            </p>
          </div>
        )}
      </section>
    </section>
  );
}
