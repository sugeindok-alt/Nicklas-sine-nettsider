import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Frontier,
  moveFighter,
  neutral,
  type FrontierGame,
} from "../lib/frontier";
import { FrontierBot } from "../lib/frontier-bot";
const make = (g: FrontierGame) => new Frontier(g, ["a", "b"], 0, () => 0.4);
function advance(e: Frontier, ms: number) {
  const end = e.view.now + ms;
  for (let n = e.view.now + 1000 / 60; n <= end + 0.01; n += 1000 / 60)
    e.tick(n);
}
test("authoritative movement expires stale inputs and resolves solid walls", () => {
  const e = make("core");
  advance(e, 2000);
  const p = e.view.players.a;
  Object.assign(p, { x: 200, y: 170, vx: 900, vy: 0 });
  moveFighter(p, e.view, { ...neutral(), dx: 1 }, 0.1, 2000);
  assert(p.x <= 208.01, "cannot tunnel into cover at high velocity");
  e.action(
    "a",
    { dx: 1, seq: 10, challengeId: "transport-metadata" } as any,
    2000,
  );
  e.action("a", { dx: -1, seq: 9 }, 2010);
  assert.equal(p.input.dx, 1);
  advance(e, 1000);
  assert.equal(p.input.dx, 0);
});
test("ring-outs, charged pushes and facing blocks have real consequences", () => {
  const e = make("knockout");
  advance(e, 2000);
  const a = e.view.players.a,
    b = e.view.players.b;
  a.x = 500;
  b.x = 565;
  b.invulnerable = 0;
  e.action("a", { primary: true, aimX: 1, aimY: 0 }, e.view.now);
  advance(e, 350);
  e.action("a", { primary: false }, e.view.now);
  assert(b.vx > 500);
  b.x = 900;
  advance(e, 20);
  assert.equal(e.view.points.a, 1);
  assert.equal(b.teleports, 1);
  assert(e.view.resetUntil > e.view.now);
});
test("momentum ball scores only through the goal mouth", () => {
  const e = make("ball");
  advance(e, 2000);
  Object.assign(e.view.ball, { x: 980, y: 100, vx: 600, vy: 0 });
  advance(e, 100);
  assert.equal(e.view.points.a, 0);
  assert(e.view.ball.vx < 0);
  Object.assign(e.view.ball, { x: 980, y: 300, vx: 600, vy: 0 });
  advance(e, 100);
  assert.equal(e.view.points.a, 1);
  assert.equal(e.view.players.a.stats.goals, 1);
});
test("grapple attaches to an anchor, preserves swing momentum and restores checkpoints", () => {
  const e = make("grapple");
  advance(e, 2000);
  const p = e.view.players.a;
  p.x = 300;
  p.y = 300;
  e.action("a", { primary: true, aimX: 1, aimY: -1 }, e.view.now);
  assert(p.hook);
  advance(e, 150);
  assert(Math.abs(p.vx) + Math.abs(p.vy) > 50);
  const vx = p.vx;
  e.action("a", { primary: false }, e.view.now);
  assert.equal(p.hook, null);
  assert.equal(p.vx, vx);
  p.checkpoint = 1;
  p.y = 750;
  advance(e, 20);
  assert.equal(p.teleports, 1);
  assert(Math.abs(p.x - e.view.checkpoints[1].x) < 10);
});
test("shadow state hides coordinates, scans reveal and both roles receive equal time budgets", () => {
  const e = make("shadow");
  advance(e, 2200);
  assert.equal(e.snapshot("a").players.b.hidden, true);
  assert.equal(e.snapshot("a").players.b.x, -1000);
  Object.assign(e.view.players.a, { x: 800, y: 300 });
  e.action("a", { primary: true }, e.view.now);
  assert.notEqual(e.snapshot("a").players.b.hidden, true);
  Object.assign(e.view.players.a, { x: 870, y: 300 });
  advance(e, 20);
  assert.equal(e.view.leg, 2);
  assert.equal(e.view.hunter, "b");
  assert(Math.abs(e.view.legEnds - e.view.now - 45000) < 20);
});
test("core scores uncontested occupation and stops scoring when contested", () => {
  const e = make("core");
  advance(e, 2000);
  const a = e.view.players.a,
    b = e.view.players.b;
  a.x = 500;
  a.y = 300;
  advance(e, 500);
  assert(e.view.points.a >= 4);
  b.x = 550;
  b.y = 300;
  const before = e.view.points.a;
  advance(e, 500);
  assert.equal(e.view.points.a, before);
});
test("showdown draws unique games and settles on three wins with per-round statistics", () => {
  const e = make("showdown");
  let n = 0;
  while (!e.view.ended && n++ < 10) {
    e.view.points.a = 5000;
    e.view.points.b = 0;
    e.view.deadline = e.view.now;
    e.tick(e.view.now + 1);
    if (e.view.transitionUntil) e.tick(e.view.transitionUntil + 1);
  }
  assert(e.view.ended);
  assert.equal(e.view.history.length, 3);
  assert.equal(e.view.seriesScore.a, 3);
  assert.equal(new Set(e.view.history.map((x) => x.game)).size, 3);
  assert(e.view.history.every((x) => x.stats.a));
});
test("AI plays the five mechanics with bounded inputs and no direct score mutation", () => {
  for (const game of [
    "knockout",
    "ball",
    "grapple",
    "shadow",
    "core",
  ] as const) {
    const e = make(game),
      bots = [new FrontierBot("a", "hard"), new FrontierBot("b", "medium")];
    for (let t = 50; t < 10000; t += 50) {
      for (const bot of bots) {
        const input = bot.think(e.snapshot(bot.id), t);
        if (input) {
          assert(Math.abs(input.dx) <= 1 && Math.abs(input.dy) <= 1);
          e.action(bot.id, input, t);
        }
      }
      e.tick(t);
    }
    assert(
      Object.values(e.view.players).every((p) =>
        Number.isFinite(p.x + p.y + p.vx + p.vy),
      ),
    );
    if (game === "grapple")
      assert(
        e.view.points.a > 300,
        "grapple bot must advance through the course",
      );
  }
});
