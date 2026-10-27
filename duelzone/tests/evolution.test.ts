import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dailyConfig, dailyTarget, dailyShot } from "../lib/daily";
import { selectDraft, draftGames } from "../lib/draft";
import { Frontier } from "../lib/frontier";
import { Database } from "../server/db";
import { awardMastery, masteryProfile } from "../server/evolution-data";
import { Match } from "../server/game";
test("Daily circuit is identical per UTC day and version; scoring rejects impossible, early, expired and invalid shots", () => {
  const a = dailyConfig("2026-10-27"),
    b = dailyConfig("2026-10-27"),
    c = dailyConfig("2026-10-28");
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, c.seed);
  for (let i = 0; i < 30; i++) {
    const elapsed = i * 1000 + 450,
      t = dailyTarget(a, i, elapsed);
    assert.deepEqual(t, dailyTarget(b, i, elapsed));
    assert.equal(dailyShot(a, elapsed, i, t.x, t.y), 100);
    assert.equal(dailyShot(a, elapsed, i, 0, 0), 0);
    assert.equal(dailyShot(a, i * 1000 + 79, i, t.x, t.y), null);
    assert.equal(dailyShot(a, i * 1000 + 920, i, t.x, t.y), null);
  }
  assert.equal(dailyShot(a, 30001, 29, 500, 300), null);
  assert.equal(dailyShot(a, 500, 0, NaN, 300), null);
  assert.equal(dailyShot(a, 500, 31, 500, 300), null);
});
test("Draft honours both bans and shared preference, including identical bans; selected series ends after two wins", () => {
  const selected = selectDraft(
    [
      { ban: "shadow", preferred: "core", ready: true },
      { ban: "grapple", preferred: "core", ready: true },
    ],
    draftGames,
  );
  assert.deepEqual(selected, ["core", "knockout", "ball"]);
  assert.equal(
    selectDraft(
      [
        { ban: "shadow", preferred: null, ready: true },
        { ban: "shadow", preferred: null, ready: true },
      ],
      draftGames,
    ).length,
    3,
  );
  const game = new Frontier("showdown", ["a", "b"], 0, () => 0.5, 1, selected);
  assert.equal(game.view.game, "core");
  game.view.points.a = 100;
  game.tick(100000);
  assert.equal(game.view.ended, false);
  game.tick(104001);
  assert.equal(game.view.game, "knockout");
  game.view.points.a = 10;
  game.tick(210000);
  assert.equal(game.view.ended, true);
  assert.equal(game.view.history.length, 2);
  assert.deepEqual(game.view.seriesScore, { a: 2, b: 0 });
});
test("Mastery is atomic and idempotent, caps repeat rivals, excludes forfeits/AI/zero scores, and preserves old records", async () => {
  const db = new Database(undefined, "memory://");
  await db.init();
  try {
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of ids.entries())
      await db.query(
        "INSERT INTO users(id,username,username_key,email,password_hash) VALUES($1,$2,$2,$3,'test-only')",
        [id, "Mastery" + i, `mastery${i}@example.invalid`],
      );
    const players = await Promise.all(ids.map((id) => db.player(id)));
    let first: ReturnType<Match["snapshot"]> | null = null;
    for (let n = 0; n < 8; n++) {
      const opponent = players[n < 4 ? 1 : n < 6 ? 2 : 3]!;
      const m = new Match(
        [players[0]!, opponent],
        "aim",
        "casual",
        () => {},
        async () => ({}),
      );
      m.state.phase = "finished";
      m.state.reason = "Score";
      m.state.winner = ids[0];
      m.state.scores = { [ids[0]]: 500, [opponent.id]: 100 };
      await db.beginMatch(m.state);
      await db.finishMatch(m.state);
      if (!first) first = m.snapshot();
    }
    assert.equal(
      (
        await db.query<{ xp: number }>(
          "SELECT xp FROM game_mastery WHERE user_id=$1 AND game='aim'",
          [ids[0]],
        )
      ).rows[0].xp,
      250,
    );
    await db.transaction((sql) => awardMastery(sql, first!));
    assert.equal((await masteryProfile(db, ids[0]))[0].xp, 250);
    assert.equal((await masteryProfile(db, ids[0]))[0].played, 8);
    for (const reason of ["Forfeit", "Score"]) {
      const m = new Match(
        [players[0]!, players[1]!],
        "precision",
        "casual",
        () => {},
        async () => ({}),
      );
      m.state.reason = reason;
      m.state.scores = { [ids[0]]: 0, [ids[1]]: 0 };
      await db.beginMatch(m.state);
      await db.finishMatch(m.state);
    }
    assert.equal(
      (await db.query("SELECT * FROM game_mastery WHERE game='precision'")).rows
        .length,
      0,
    );
    const idle = new Match(
      [players[0]!, players[1]!],
      "showdown",
      "casual",
      () => {},
      async () => ({}),
    );
    const idleEngine = new Frontier(
      "showdown",
      [ids[0], ids[1]],
      0,
      () => 0.5,
      1,
      ["core", "knockout", "ball"],
    );
    for (const at of [30000, 34001, 65000, 69001, 100000]) idleEngine.tick(at);
    idle.state.reason = "Score";
    idle.state.phase = "finished";
    idle.state.frontier = idleEngine.snapshot();
    idle.state.scores = idleEngine.scores();
    assert(idle.state.scores[ids[0]] > 0);
    await db.beginMatch(idle.state);
    await db.finishMatch(idle.state);
    assert.equal(
      (await db.query("SELECT * FROM game_mastery WHERE game='showdown'")).rows
        .length,
      0,
    );
    const before = (await db.query("SELECT * FROM game_mastery")).rows;
    await db.init();
    assert.deepEqual(
      (await db.query("SELECT * FROM game_mastery")).rows,
      before,
    );
  } finally {
    await db.close();
  }
});

test("Replay interpolation preserves authoritative scores and never smooths respawns; ghost identity has no live inputs", async () => {
  const { replayFrame, ghostFighter } = await import("../lib/replay");
  const game = new Frontier("grapple", ["a", "b"], 1000, () => 0.5);
  const first = game.snapshot(),
    next = structuredClone(first);
  first.players.a.x = 100;
  next.players.a.x = 200;
  next.now = 1200;
  next.points.a = 42;
  const replay = {
    version: 1 as const,
    matchId: "recorded",
    game: "grapple" as const,
    players: [],
    duration: 200,
    frames: [
      { at: 0, view: first },
      { at: 200, view: next },
    ],
    highlights: [],
  };
  assert.equal(replayFrame(replay, 100).players.a.x, 150);
  assert.equal(replayFrame(replay, 100).points.a, first.points.a);
  assert.equal(replayFrame(replay, 200).points.a, 42);
  assert.equal(replayFrame(replay, 1000).players.a.x, 200);
  next.players.a.teleports++;
  assert.equal(replayFrame(replay, 100).players.a.x, 100);
  const ghost = ghostFighter(first.players.a, "ghost:copy", 5000, 1000);
  assert.equal(ghost.id, "ghost:copy");
  assert.equal(ghost.input.dx, 0);
  assert.equal(ghost.input.primary, false);
  assert.equal(ghost.dashUntil, first.players.a.dashUntil + 4000);
  ghost.stats.hits = 999;
  assert.notEqual(first.players.a.stats.hits, 999);
});
