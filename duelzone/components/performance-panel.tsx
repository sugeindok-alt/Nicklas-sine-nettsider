"use client";
import { useEffect, useState } from "react";
import { network } from "@/lib/match-feed";
type Options = { panel: boolean; effects: boolean };
const defaults: Options = { panel: false, effects: true };
function read(): Options {
  try {
    return {
      ...defaults,
      ...JSON.parse(localStorage.getItem("dz:performance") || "{}"),
    };
  } catch {
    return defaults;
  }
}
export function PerformanceSettings() {
  const [options, setOptions] = useState(defaults);
  useEffect(() => setOptions(read()), []);
  function update(next: Options) {
    setOptions(next);
    try {
      localStorage.setItem("dz:performance", JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event("dz:performance"));
  }
  return (
    <section className="panel mastery-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">TUNE YOUR EXPERIENCE</span>
          <h2>Performance & effects.</h2>
        </div>
      </div>
      <label className="runtime-option">
        <span>
          <b>Performance panel</b>
          <small>
            Display browser frame cadence, round-trip time and probe timeouts.
          </small>
        </span>
        <input
          type="checkbox"
          checked={options.panel}
          onChange={(e) => update({ ...options, panel: e.target.checked })}
        />
      </label>
      <label className="runtime-option">
        <span>
          <b>Reduced effects</b>
          <small>
            Reduce decorative animation. Your system’s reduced-motion preference
            is always respected.
          </small>
        </span>
        <input
          type="checkbox"
          checked={!options.effects}
          onChange={(e) => update({ ...options, effects: !e.target.checked })}
        />
      </label>
      <p className="small muted">
        Settings are saved on this device. FPS measures browser animation
        frames, not server ticks. Round-trip variation is measured from recent
        probes. WebSocket packet loss is not directly measurable here.
      </p>
    </section>
  );
}
export function PerformancePanel({ connected }: { connected: boolean }) {
  const [options, setOptions] = useState(defaults),
    [sample, setSample] = useState({
      fps: 0,
      rtt: 0,
      jitter: 0,
      failed: 0,
      total: 0,
    });
  useEffect(() => {
    const apply = () => {
      const value = read();
      setOptions(value);
      document.documentElement.dataset.effects = value.effects ? "full" : "low";
    };
    apply();
    window.addEventListener("dz:performance", apply);
    return () => window.removeEventListener("dz:performance", apply);
  }, []);
  useEffect(() => {
    if (!options.panel) return;
    let frame = 0,
      frames = 0,
      at = performance.now();
    const draw = (now: number) => {
      frames++;
      if (now - at >= 1500) {
        const samples = network.samples;
        setSample({
          fps: document.hidden ? 0 : Math.round((frames * 1000) / (now - at)),
          rtt: network.rtt,
          jitter:
            samples.length < 2
              ? 0
              : samples
                  .slice(1)
                  .reduce((sum, v, i) => sum + Math.abs(v - samples[i]), 0) /
                (samples.length - 1),
          failed: network.failed,
          total: network.total,
        });
        frames = 0;
        at = now;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [options.panel]);
  return options.panel ? (
    <aside className="performance-panel" aria-label="Performance measurements">
      <b>{connected ? "LIVE" : "OFFLINE"}</b>
      <span>{sample.fps || "—"} FPS</span>
      <span>
        {connected && sample.rtt ? Math.round(sample.rtt) : "—"} ms RTT
      </span>
      <span>{Math.round(sample.jitter)} ms variation</span>
      <span>
        {sample.failed}/{sample.total} probes timed out
      </span>
    </aside>
  ) : null;
}
