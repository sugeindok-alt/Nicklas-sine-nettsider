"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Share2, RotateCcw, ArrowRight } from "lucide-react";
import { replayFrame, type Replay } from "@/lib/replay";
import { GAME_INFO } from "@/lib/shared";
import { api } from "@/lib/client";
import { renderFrontier } from "./frontier-field";
import Modal from "./modal";
import type { Command } from "./platform-center";
export function ReplayViewer({
  id,
  share,
  startAt = 0,
  onClose,
}: {
  id: string;
  share?: string;
  startAt?: number;
  onClose: () => void;
}) {
  const [replay, setReplay] = useState<Replay | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [position, setPosition] = useState(startAt),
    [focus, setFocus] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    at = useRef(startAt);
  useEffect(() => {
    let live = true;
    api<{ replay: Replay }>(
      `/replays/${id}${share ? `?share=${encodeURIComponent(share)}` : ""}`,
    )
      .then((r) => {
        if (live) {
          setReplay(r.replay);
          setFocus(r.replay.players[0].id);
          at.current = Math.max(0, Math.min(startAt, r.replay.duration));
          setPosition(at.current);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, share, startAt]);
  useEffect(() => {
    if (!replay) return;
    let frame = 0,
      last = performance.now(),
      hud = last;
    const draw = (now: number) => {
      if (playing)
        at.current = Math.min(
          replay.duration,
          at.current + (now - last) * speed,
        );
      last = now;
      const v = replayFrame(replay, at.current),
        ctx = canvas.current?.getContext("2d");
      if (ctx) {
        const x =
          v.game === "grapple"
            ? Math.max(
                0,
                Math.min(v.width - 1000, (v.players[focus]?.x || 0) - 330),
              )
            : 0;
        renderFrontier(ctx, v, replay.players, focus, x, v.now, {
          id: v.event.id,
          born: v.now,
        });
      }
      if (now - hud > 100) {
        setPosition(at.current);
        hud = now;
      }
      if (at.current >= replay.duration) setPlaying(false);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [replay, playing, speed, focus]);
  function seek(value: number) {
    at.current = value;
    setPosition(value);
  }
  async function shareMoment() {
    setError("");
    try {
      const r = await api<{ url: string }>(`/replays/${id}/share`, {});
      const link = r.url + "&at=" + Math.floor(at.current);
      await navigator.clipboard.writeText(link);
      setMessage(
        "Replay link copied at this moment. Both players’ sharing preferences control access.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={
        replay ? `${GAME_INFO[replay.game].name} / Replay` : "Match replay"
      }
      wide
      onClose={onClose}
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!replay && !error && (
        <p className="muted">Loading the recorded match…</p>
      )}
      {replay && (
        <>
          <div className="replay-meta">
            <span className="eyebrow">MATCH RECORDING</span>
            <label>
              Follow
              <select
                aria-label="Replay player"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
              >
                {replay.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.username}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <canvas
            ref={canvas}
            className="replay-canvas"
            width={1000}
            height={600}
            aria-label="Read-only playback of the recorded match"
          />
          <div className="replay-controls">
            <button
              className="button secondary compact"
              onClick={() => {
                if (position >= replay.duration) seek(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
              {playing ? "Pause" : "Play"}
            </button>
            <button
              className="icon-button"
              aria-label="Restart replay"
              onClick={() => seek(0)}
            >
              <RotateCcw size={16} />
            </button>
            <span className="mono">
              {(position / 1000).toFixed(1)} /{" "}
              {(replay.duration / 1000).toFixed(1)}s
            </span>
            <select
              aria-label="Replay speed"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.25, 0.5, 1, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <button className="text-button" onClick={() => void shareMoment()}>
              <Share2 size={14} />
              Share this moment
            </button>
          </div>
          <input
            className="replay-timeline"
            type="range"
            aria-label="Replay timeline"
            min={0}
            max={replay.duration}
            step={50}
            value={position}
            onChange={(e) => seek(Number(e.target.value))}
          />
          {message && (
            <p className="small accent" role="status">
              {message}
            </p>
          )}
          <div className="replay-highlights">
            <span className="eyebrow">RECORDED MOMENTS</span>
            {replay.highlights.length ? (
              replay.highlights.map((h, i) => (
                <button
                  className="text-button"
                  key={i}
                  onClick={() => {
                    seek(Math.max(0, h.at - 2500));
                    setPlaying(true);
                  }}
                >
                  {(h.at / 1000).toFixed(1)}s · {h.label}
                  <ArrowRight size={13} />
                </button>
              ))
            ) : (
              <p className="small muted">
                No goal or comeback moments in this recording. Use the timeline
                to find your own.
              </p>
            )}
          </div>
          <p className="small muted">
            Watch the match as it happened. The latest 200 supported match
            recordings are available; older recordings expire without removing
            your results or statistics. Sharing requires both players to opt in
            under Friends → Privacy.
          </p>
        </>
      )}
    </Modal>
  );
}
type Ghost = {
  match_id: string;
  user_id: string;
  username: string;
  score: number;
  duration: number;
  created_at: string;
};
export function GhostLibrary({
  revision,
  command,
  onReplay,
}: {
  revision: number;
  command: Command;
  onReplay: (id: string) => void;
}) {
  const [ghosts, setGhosts] = useState<Ghost[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ ghosts: Ghost[] }>("/ghosts")
      .then((r) => {
        if (live) setGhosts(r.ghosts);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  async function race(g: Ghost) {
    setBusy(true);
    setError("");
    try {
      await command("ghost:start", {
        replayId: g.match_id,
        sourceId: g.user_id,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ghost-library">
      <div className="section-heading">
        <div>
          <span className="eyebrow">GRAPPLE RUSH / GHOST BATTLES</span>
          <h2>A time to beat.</h2>
        </div>
      </div>
      <p className="muted small">
        Race a recorded performance on the same course for the same duration.
        Ghosts follow actual server snapshots and cannot collide with you. Your
        result is saved as training, with no ranked points.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {ghosts?.length ? (
        ghosts.map((g) => (
          <div className="ghost-row" key={g.match_id + g.user_id}>
            <div>
              <b>{g.username}</b>
              <small>
                {g.score.toLocaleString()} distance ·{" "}
                {(g.duration / 1000).toFixed(1)} seconds ·{" "}
                {new Date(g.created_at).toLocaleDateString()}
              </small>
            </div>
            <button
              className="text-button"
              onClick={() => onReplay(g.match_id)}
            >
              Replay
            </button>
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() => void race(g)}
            >
              Race ghost
              <ArrowRight size={14} />
            </button>
          </div>
        ))
      ) : (
        <p className="activity-empty">
          {ghosts
            ? "Complete a multiplayer Grapple Rush match to record your first run. Friends’ eligible runs appear when both original players allow replay sharing."
            : "Loading recorded runs…"}
        </p>
      )}
    </section>
  );
}
