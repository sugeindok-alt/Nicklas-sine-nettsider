"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Crosshair,
  Timer,
  Trophy,
  Check,
  RotateCcw,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { api } from "@/lib/client";
import { dailyTarget, type DailyOverview, type DailyRun } from "@/lib/daily";
import { network } from "@/lib/match-feed";
import Modal from "./modal";
import type { Command } from "./platform-center";

export function DailyHub({
  signedIn,
  connected,
  command,
  signIn,
  revision,
}: {
  signedIn: boolean;
  connected: boolean;
  command: Command;
  signIn: () => void;
  revision: number;
}) {
  const [data, setData] = useState<DailyOverview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    api<DailyOverview>("/daily")
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => setError(e.message));
    return () => {
      live = false;
    };
  }, [signedIn, revision, new Date(now).toISOString().slice(0, 10)]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(
    0,
    Math.floor(((data ? Date.parse(data.resetAt) : now) - now) / 1000),
  );
  async function start() {
    if (!signedIn) {
      signIn();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await command("daily:start");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="daily-hub">
      <div className="daily-heading">
        <span className="eyebrow">
          DAILY DUEL / {data?.config.day || "TODAY"}
        </span>
        <span className="daily-reset">
          <Timer size={14} />
          {[
            Math.floor(remaining / 3600),
            Math.floor(remaining / 60) % 60,
            remaining % 60,
          ]
            .map((n) => String(n).padStart(2, "0"))
            .join(":")}{" "}
          until reset
        </span>
      </div>
      <div className="daily-hero">
        <div>
          <h1>
            One circuit.
            <br />
            <span>Everyone’s best shot.</span>
          </h1>
          <p>
            Thirty moving targets. Thirty seconds. The same sequence for every
            player, with a fresh circuit at midnight UTC.
          </p>
          <button
            className="button primary"
            disabled={
              busy || (signedIn && !connected) || (data?.attempts || 0) >= 30
            }
            onClick={() => void start()}
          >
            <Crosshair size={17} />
            {busy ? "Preparing circuit…" : "Play today’s circuit"}
            <ArrowRight size={17} />
          </button>
          <small>
            {signedIn
              ? `${data?.attempts || 0} / 30 attempts used today`
              : "Sign in to save your score and join the board"}
          </small>
        </div>
        <div className="daily-scorecard">
          <span className="eyebrow">YOUR BEST TODAY</span>
          <strong>
            {data?.personal ? data.personal.score.toLocaleString() : "—"}
          </strong>
          <span>
            {data?.personal
              ? `${data.personal.hits} / 30 targets · ${data.personal.shots ? Math.round((data.personal.hits / data.personal.shots) * 100) : 0}% hit rate`
              : "Your first run sets the mark."}
          </span>
          <div className="daily-target-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <Crosshair size={34} />
          </div>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="daily-rules">
        <span>
          <b>01</b> One shot per target
        </span>
        <span>
          <b>02</b> Centre hits earn 100 points
        </span>
        <span>
          <b>03</b> Best completed run counts
        </span>
      </div>
      <p className="small muted daily-explanation">
        Targets accept shots 80–920 ms after appearing. Misses score zero.
        Timing uses the server’s clock, so connection latency matters. Daily
        scores are separate from ranked Elo. Reset locally:{" "}
        {data
          ? new Date(data.resetAt).toLocaleString([], {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "…"}
        .
      </p>
      <div className="daily-columns">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">TODAY’S FIELD</span>
              <h2>The daily board.</h2>
            </div>
            <Trophy size={21} />
          </div>
          {!data ? (
            <p className="muted">Loading today’s circuit…</p>
          ) : data.board.length ? (
            <div className="table-scroll">
              <table className="board-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>PLAYER</th>
                    <th>SCORE</th>
                    <th>HITS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.board.map((p, i) => (
                    <tr key={p.user_id}>
                      <td>{String(i + 1).padStart(2, "0")}</td>
                      <td>{p.username}</td>
                      <td className="mono bright">
                        {p.score.toLocaleString()}
                      </td>
                      <td>{p.hits}/30</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <Crosshair size={28} />
              <h3>Set the first score.</h3>
              <p>Completed runs appear here. No opponent needs to be online.</p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">YOUR LAST 14 CIRCUITS</span>
              <h2>A better personal best.</h2>
            </div>
          </div>
          {data?.history.length ? (
            data.history.map((h) => (
              <div className="daily-history" key={h.day}>
                <span>
                  {new Date(h.day + "T12:00:00Z").toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                  })}
                  <small>{h.hits} targets hit</small>
                </span>
                <strong className="mono">{h.score.toLocaleString()}</strong>
              </div>
            ))
          ) : (
            <p className="muted">
              Your completed daily circuits will build a personal record here.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

export function DailyArena({
  run,
  socket,
  command,
  onClose,
}: {
  run: DailyRun;
  socket: Socket | null;
  command: Command;
  onClose: () => void;
}) {
  const [elapsed, setElapsed] = useState(run.serverNow - run.startedAt),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false);
  const anchor = useRef({
    at: performance.now(),
    elapsed: run.serverNow - run.startedAt,
  });
  const submitted = useRef(new Set<number>());
  useEffect(() => {
    anchor.current = {
      at: performance.now(),
      elapsed: run.serverNow - run.startedAt + Math.min(network.rtt / 2, 200),
    };
  }, [run.serverNow, run.startedAt]);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      setElapsed(
        anchor.current.elapsed + performance.now() - anchor.current.at,
      );
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  const index = Math.floor(Math.max(0, elapsed) / run.config.interval),
    target = dailyTarget(run.config, index, elapsed);
  const active =
    run.status === "active" && elapsed >= 0 && elapsed < run.config.duration;
  const attempted = run.attempted.includes(index),
    hit = run.last?.index === index && run.last.points > 0;
  async function close() {
    setClosing(true);
    try {
      if (run.status === "active") await command("daily:cancel");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClosing(false);
    }
  }
  return (
    <Modal
      title={
        run.status === "finished"
          ? "Your daily mark."
          : "Daily Duel / Focus circuit"
      }
      wide
      onClose={() => {
        if (!closing) void close();
      }}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {run.status === "finished" ? (
        <div className="daily-finish">
          <Check size={34} />
          <span className="eyebrow">
            {run.saved ? "RESULT SAVED" : "SAVING RESULT"}
          </span>
          <strong>{run.score.toLocaleString()}</strong>
          <p>
            {run.hits} targets ·{" "}
            {run.shots ? Math.round((run.hits / run.shots) * 100) : 0}% hit rate
            · out of 3,000 points
          </p>
          <p className="muted">
            Your highest completed score is on today’s board.
          </p>
          <button className="button primary" onClick={onClose}>
            View daily board
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="daily-hud">
            <span>
              <small>SCORE</small>
              <b>{run.score.toLocaleString()}</b>
            </span>
            <span>
              <small>TARGETS</small>
              <b>{run.hits}/30</b>
            </span>
            <span>
              <small>REMAINING</small>
              <b>
                {Math.max(
                  0,
                  Math.ceil(
                    (run.config.duration - Math.max(0, elapsed)) / 1000,
                  ),
                )}
                s
              </b>
            </span>
          </div>
          <svg
            className="daily-field"
            viewBox="0 0 1000 600"
            role="img"
            aria-label="Aim at each moving target. One shot per target."
            onPointerDown={(e) => {
              if (
                !active ||
                attempted ||
                submitted.current.has(index) ||
                !socket?.connected ||
                target.age < 80 ||
                target.age >= 920
              )
                return;
              const r = e.currentTarget.getBoundingClientRect();
              submitted.current.add(index);
              socket.emit("daily:shot", {
                id: run.id,
                index,
                x: ((e.clientX - r.left) / r.width) * 1000,
                y: ((e.clientY - r.top) / r.height) * 600,
              });
            }}
          >
            <defs>
              <pattern
                id="daily-grid"
                width="50"
                height="50"
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 50 0 L 0 0 0 50"
                  fill="none"
                  stroke="#262b30"
                  strokeWidth="1"
                />
              </pattern>
            </defs>
            <rect width="1000" height="600" fill="#111518" />
            <rect width="1000" height="600" fill="url(#daily-grid)" />
            {active && (
              <g
                transform={`translate(${target.x} ${target.y})`}
                opacity={target.age < 80 || target.age >= 920 ? 0.25 : 1}
              >
                <circle
                  r={run.config.radius + 13}
                  fill="none"
                  stroke={hit ? "#c8f36a" : "#647078"}
                  strokeWidth="1"
                  strokeDasharray="4 7"
                />
                <circle
                  r={run.config.radius}
                  fill={attempted ? "#20282b" : "#c8f36a"}
                  stroke={hit ? "#c8f36a" : "#cbd4d8"}
                  strokeWidth="2"
                />
                <circle r="6" fill={attempted ? "#c8f36a" : "#17220e"} />
                {attempted && (
                  <text
                    y="-65"
                    textAnchor="middle"
                    fill="#e8eeea"
                    fontSize="22"
                  >
                    {hit ? `+${run.last!.points}` : "MISS"}
                  </text>
                )}
              </g>
            )}
            {elapsed < 0 && (
              <>
                <text
                  x="500"
                  y="280"
                  textAnchor="middle"
                  fill="#edf0ef"
                  fontSize="72"
                >
                  {Math.ceil(-elapsed / 1000)}
                </text>
                <text
                  x="500"
                  y="330"
                  textAnchor="middle"
                  fill="#9ca7ad"
                  fontSize="20"
                >
                  Find the centre. Make the shot.
                </text>
              </>
            )}
            {elapsed >= run.config.duration && (
              <text
                x="500"
                y="300"
                textAnchor="middle"
                fill="#edf0ef"
                fontSize="24"
              >
                Saving your result…
              </text>
            )}
          </svg>
          <div className="daily-footnote">
            <span>
              {socket?.connected
                ? "Live connection · scores verified by the server"
                : "Reconnecting… The circuit clock continues."}
            </span>
            <button
              className="text-button"
              disabled={closing}
              onClick={() => void close()}
            >
              <RotateCcw size={14} />
              End attempt
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
