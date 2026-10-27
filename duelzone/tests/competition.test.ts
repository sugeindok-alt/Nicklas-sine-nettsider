import test from "node:test";
import assert from "node:assert/strict";
import { Competition } from "../lib/competition";
import { Database, newId } from "../server/db";
import { Match } from "../server/game";
import { dailyGame } from "../lib/progression";

function engine(game: string, random = () => 0.37) {
  return new Competition(game, ["a", "b"], 10000, random);
}
test("Dodge clamps movement, expires stale input, and keeps dash on cooldown", () => {
  const e = engine("dodge"),
    p = e.view.players.a;
  e.action("a", { dx: 100, dy: 0 }, 10000);
  e.tick(10050);
  assert(p.x > 0.32 && p.x < 0.35);
  const x = p.x;
  e.tick(10600);
  assert.equal(p.x, x);
  e.action("a", { ability: true }, 10400);
  const ready = p.readyAt;
  e.action("a", { ability: true }, 11000);
  assert.equal(p.readyAt, ready);
  for (let t = 11000; t <= 13000; t += 50) {
    e.action("a", { dx: 1, dy: 1 }, t);
    e.tick(t);
  }
  assert(p.x <= 0.975 && p.y <= 0.975);
});
test("Dodge applies one hit during invulnerability and resolves last standing", () => {
  const e = engine("dodge"),
    p = e.view.players.a;
  e.view.hazards.push({
    id: "collision",
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    radius: 0.03,
    activeAt: 10000,
  });
  e.tick(11100);
  assert.equal(p.hp, 2);
  e.tick(11200);
  assert.equal(p.hp, 2);
  e.tick(12300);
  assert.equal(p.hp, 1);
  e.tick(13500);
  assert.equal(p.hp, 0);
  assert(e.view.ended);
  assert(e.scores().b > e.scores().a);
});
test("Grid rejects remote captures and rapid clicks; fortification blocks steals", () => {
  const e = engine("grid");
  e.action("a", { tile: 0 }, 10000);
  assert.equal(e.view.tiles[0], null);
  e.action("a", { tile: 43 }, 10000);
  assert.equal(e.view.tiles[43], "a");
  e.action("a", { tile: 44 }, 10100);
  assert.equal(e.view.tiles[44], null);
  e.action("a", { tile: 44 }, 10300);
  e.action("a", { tile: 45 }, 10600);
  e.action("a", { ability: true }, 10650);
  assert.equal(e.view.players.a.energy, 0);
  e.view.tiles[46] = "b";
  e.action("b", { tile: 45 }, 10700);
  assert.equal(e.view.tiles[45], "a");
  e.action("b", { tile: 45 }, 15000);
  assert.equal(e.view.tiles[45], "b");
  e.view.bonusTile = 45;
  e.view.bonusUntil = 20000;
  e.tick(15010);
  assert(e.view.points.b >= 360);
});
test("Aim Clash consumes shared targets once, rewards combos and penalizes misses", () => {
  const e = engine("clash"),
    t = e.view.targets.find((t) => t.kind === "normal")!;
  e.action("a", { x: t.x, y: t.y, target: t.id }, 10000);
  assert.equal(e.view.points.a, 100);
  e.action("b", { x: t.x, y: t.y, target: t.id }, 10100);
  assert.equal(e.view.points.b, 0);
  for (let i = 1; i < 8; i++) {
    const target = e.view.targets.find((t) => t.kind === "normal")!;
    e.action(
      "a",
      { x: target.x, y: target.y, target: target.id },
      10000 + i * 150,
    );
  }
  assert.equal(e.view.players.a.combo, 8);
  assert(e.view.points.a > 800);
  e.action("a", { x: 0, y: 0 }, 12000);
  assert.equal(e.view.players.a.combo, 0);
  const power = e.view.targets.find((t) => t.kind === "power")!;
  e.action("a", { x: power.x, y: power.y, target: power.id }, 12200);
  e.action("a", { ability: true }, 12400);
  assert.equal(e.view.players.a.focusUntil, 15400);
});
test("Mind Battle hides memorized sequences, rejects early/stale answers, scores once", () => {
  const e = engine("mind"),
    puzzle = e.view.puzzle!,
    sequence = [...puzzle.sequence];
  e.action("a", { puzzleId: puzzle.id, tile: sequence[0] }, 10010);
  assert.equal(e.view.players.a.progress, 0);
  e.tick(puzzle.revealUntil + 1);
  assert.deepEqual(e.snapshot().puzzle!.sequence, []);
  e.action(
    "a",
    { puzzleId: "stale", tile: sequence[0] },
    puzzle.revealUntil + 5,
  );
  assert.equal(e.view.players.a.progress, 0);
  sequence.forEach((tile, i) =>
    e.action(
      "a",
      { puzzleId: puzzle.id, tile },
      puzzle.revealUntil + 50 + i * 150,
    ),
  );
  assert(e.view.players.a.solved);
  const points = e.view.points.a;
  e.action(
    "a",
    { puzzleId: puzzle.id, tile: sequence[0] },
    puzzle.revealUntil + 1500,
  );
  assert.equal(e.view.points.a, points);
  assert(!("answer" in e.snapshot()));
});
test("Speed Arena runs six distinct stages, caps stage points and rejects post-match input", () => {
  const e = engine("arena"),
    stages: string[] = [];
  for (let n = 0; n < 6; n++) {
    stages.push(e.view.discipline);
    e.view.points.a = 99999;
    if (e.view.discipline === "dodge") e.view.players.a.hp = 3;
    e.tick(e.view.stageEnds + 1);
    if (!e.view.ended) e.tick(e.view.transitionUntil + 1);
  }
  assert.equal(stages.length, 6);
  assert.equal(new Set(stages).size, 4);
  assert(e.view.ended);
  assert(e.scores().a <= 6000);
  const before = structuredClone(e.scores());
  e.action(
    "a",
    { choice: 0, tile: 0, x: 0.5, y: 0.5, ability: true },
    e.view.now + 1,
  );
  assert.deepEqual(e.scores(), before);
});
test("Progression awards are transactional, daily goals unique, match XP capped, forfeits excluded", async () => {
  const db = new Database(undefined, "memory://");
  await db.init();
  const a = newId(),
    b = newId();
  for (const id of [a, b])
    await db.query(
      "INSERT INTO users(id,username,username_key,email,password_hash) VALUES($1,$1,$1,$2,'unused')",
      [id, id + "@example.invalid"],
    );
  let last: Match | undefined;
  for (let n = 0; n < 7; n++) {
    const m = new Match(
      [(await db.player(a))!, (await db.player(b))!],
      dailyGame(),
      "ranked",
      () => {},
      (s) => db.finishMatch(s),
    );
    m.state.scores[a] = 900;
    m.state.scores[b] = 300;
    await db.beginMatch(m.state);
    await m.finish(n === 6 ? b : undefined);
    if (n === 0) {
      assert.equal(m.state.rewards![a].xp, 500);
      await assert.rejects(db.finishMatch(m.state));
    }
    if (n === 5) assert.equal(m.state.rewards![a].xp, 0);
    if (n === 6) assert.deepEqual(m.state.rewards, {});
    m.dispose();
    last = m;
  }
  const p = (await db.profile(a))!.progression;
  assert.equal(p.daily.filter((g) => g.complete).length, 3);
  assert.equal(p.achievements.length, 2);
  assert.equal(p.weekly?.filter((g) => g.complete).length, 2);
  assert.equal(p.xp, 1100);
  assert.equal(p.level, 3);
  assert.equal(p.rewardedMatches, 5);
  assert(last);
  await db.close();
});
