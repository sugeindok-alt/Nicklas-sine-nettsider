import test from "node:test";
import assert from "node:assert/strict";
import { Competition } from "../lib/competition";
import { MovementTimeline } from "../lib/netcode";
import { BotDriver, difficulties } from "../lib/bot";
const random =
  (seed = 17) =>
  () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

test("movement sequence rejects stale or replayed commands without rewinding", () => {
  const e = new Competition("dodge", ["a", "b"], 10000);
  e.action("a", { dx: 1, dy: 0, seq: 2 }, 10001);
  e.action("a", { dx: -1, dy: 0, seq: 1 }, 10002);
  e.action("a", { dx: -1, dy: 0, seq: 2 }, 10003);
  e.tick(10050);
  assert(e.view.players.a.x > 0.32);
  assert.equal(e.view.players.a.inputSequence, 2);
  e.action("a", { dx: 0, dy: 0, seq: 3 }, 10051);
  e.tick(10100);
  assert.equal(e.view.players.a.dx, 0);
});
test("local movement predicts input before a server response, then reconciles without a jump", () => {
  const e = new Competition("dodge", ["a", "b"], 10000),
    timeline = new MovementTimeline("a");
  timeline.receive(e.snapshot(), 10080, 80);
  const before = timeline.sample(10080)!.positions.a;
  timeline.input(1, 1, 0, 10080);
  const predicted = timeline.sample(10096)!.positions.a;
  assert(
    predicted.x > before.x + 0.005,
    "input must be visible on the next frame",
  );
  e.action("a", { dx: 1, dy: 0, seq: 1 }, 10160);
  e.tick(10200);
  timeline.receive(e.snapshot(), 10280, 80);
  const corrected = timeline.sample(10280)!.positions.a;
  assert(Math.abs(corrected.x - predicted.x) < 0.09);
});
test("two moving players stay bounded and render smoothly with 60–220ms RTT, jitter and dropped frames", () => {
  for (const rtt of [60, 140, 220]) {
    const rng = random(rtt),
      e = new Competition("dodge", ["a", "b"], 10000, rng);
    const timelines = [new MovementTimeline("a"), new MovementTimeline("b")];
    const pending: { at: number; run: (deliveredAt: number) => void }[] = [];
    const previous: ({ x: number; y: number } | undefined)[] = [];
    let largestStep = 0,
      samples = 0;
    timelines.forEach((t) => t.receive(e.snapshot(), 10000 + rtt / 2, rtt / 2));
    for (let time = 10000; time < 18000; time += 10) {
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i].at <= time) {
          pending[i].run(time);
          pending.splice(i, 1);
        }
      if (time % 160 === 0)
        for (const [i, id] of ["a", "b"].entries()) {
          const angle = (time - 10000) / 1200 + i * Math.PI,
            dx = Math.cos(angle),
            dy = Math.sin(angle),
            seq = time;
          timelines[i].input(seq, dx, dy, time);
          if (rng() > 0.05)
            pending.push({
              at: time + rtt / 2 + (rng() - 0.5) * 40,
              run: (delivered) => e.action(id, { dx, dy, seq }, delivered),
            });
        }
      if (time % 50 === 0) {
        for (const p of Object.values(e.view.players)) p.shieldUntil = Infinity;
        e.tick(time);
      }
      if (time % 100 === 0) {
        const view = e.snapshot();
        for (const t of timelines)
          if (rng() > 0.05)
            pending.push({
              at: time + rtt / 2 + (rng() - 0.5) * 50,
              run: (delivered) => t.receive(view, delivered, rtt / 2),
            });
      }
      for (const [i, t] of timelines.entries()) {
        const p = t.sample(time)?.positions[i === 0 ? "a" : "b"];
        if (!p) continue;
        assert(p.x >= 0.025 && p.x <= 0.975 && p.y >= 0.025 && p.y <= 0.975);
        if (previous[i] && time > 11000)
          largestStep = Math.max(
            largestStep,
            Math.hypot(p.x - previous[i]!.x, p.y - previous[i]!.y),
          );
        previous[i] = p;
        samples++;
      }
    }
    assert(
      largestStep < 0.025,
      `RTT ${rtt}: visible movement jump ${largestStep}`,
    );
    assert(samples > 1000);
    console.log(
      `RTT ${rtt}ms: ${samples} rendered movement samples; maximum 10ms step ${(largestStep * 1000).toFixed(1)} / 1000 arena units.`,
    );
  }
});
test("all AI difficulties play all five modes through legal actions, including memory after reveal", () => {
  for (const difficulty of difficulties)
    for (const game of ["dodge", "grid", "clash", "mind", "arena"]) {
      const rng = random(37),
        engine = new Competition(game, ["human", "bot"], 10000, rng),
        bot = new BotDriver("bot", difficulty, rng);
      let inputs = 0,
        moved = false;
      for (let now = 10000; now < 110000 && !engine.view.ended; now += 50) {
        engine.tick(now);
        const action = bot.think(engine.snapshot(), now);
        if (action) {
          engine.action("bot", action, now);
          inputs++;
        }
        if (engine.view.players.bot.x !== 0.68) moved = true;
      }
      assert(inputs > 0, `${difficulty}/${game} did not act`);
      assert(engine.view.ended, `${difficulty}/${game} did not finish`);
      assert(Number.isFinite(engine.scores().bot));
      if (game === "dodge") assert(moved);
      if (game === "grid") assert(engine.scores().bot > 100);
      if (game === "clash" || game === "mind")
        assert(
          engine.scores().bot > 0,
          `${difficulty}/${game} failed to score`,
        );
    }
});
test("Expert aims materially better than Easy without submitting scores", () => {
  const totals: number[] = [];
  for (const difficulty of ["easy", "expert"] as const) {
    const rng = random(91),
      engine = new Competition("clash", ["human", "bot"], 10000, rng),
      bot = new BotDriver("bot", difficulty, rng);
    for (let now = 10000; now < 56000 && !engine.view.ended; now += 50) {
      engine.tick(now);
      const a = bot.think(engine.snapshot(), now);
      if (a) engine.action("bot", a, now);
    }
    totals.push(engine.scores().bot);
  }
  assert(totals[1] > totals[0] * 2, JSON.stringify(totals));
});
