import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { hashPassword, verifyPassword, cookieToken } from "../server/auth";
import { scoreAction, Match } from "../server/game";
import { Database, newId } from "../server/db";
import {
  elo,
  rankFor,
  seasonAt,
  markerPosition,
  type MatchState,
} from "../lib/shared";

test("Passwords use individual salts and reject incorrect secrets", async () => {
  const a = await hashPassword("a-strong-test-password"),
    b = await hashPassword("a-strong-test-password");
  assert.notEqual(a, b);
  assert(await verifyPassword("a-strong-test-password", a));
  assert.equal(await verifyPassword("incorrect", a), false);
});
test("Session cookie parsing is exact", () => {
  assert.equal(cookieToken("other=abc; dz_session=valid; theme=dark"), "valid");
  assert.equal(cookieToken("not_dz_session=secret"), undefined);
});
test("Elo rewards upsets and preserves the two-player total", () => {
  assert.equal(elo(1000, 1000, 1), 16);
  assert.equal(elo(1000, 1000, 0.5), 0);
  assert(elo(1000, 1600, 1) > elo(1000, 1000, 1));
  assert.equal(elo(1000, 1600, 1) + elo(1600, 1000, 0), 0);
});
test("Rank boundaries and UTC season rollover", () => {
  assert.equal(rankFor(1049).name, "Bronze");
  assert.equal(rankFor(1050).name, "Silver");
  assert.equal(rankFor(2200).name, "Champion");
  assert.equal(seasonAt(new Date("2026-12-31T23:59:59Z")).id, "2026-Q4");
  assert.equal(seasonAt(new Date("2027-01-01T00:00:00Z")).id, "2027-Q1");
});
test("Reaction score rejects implausibly early inputs", () => {
  assert.equal(
    scoreAction("reaction", { id: "x" }, 40, { challengeId: "x" }).points,
    0,
  );
  assert.equal(
    scoreAction("reaction", { id: "x" }, 200, { challengeId: "x" }).points,
    760,
  );
});
test("Aim is scored from geometry, never client-reported points", () => {
  const challenge = { id: "x", x: 0.5, y: 0.5 };
  assert(
    scoreAction("aim", challenge, 200, { challengeId: "x", x: 0.5, y: 0.5 })
      .points > 900,
  );
  assert.equal(
    scoreAction("aim", challenge, 200, { challengeId: "x", x: 0.8, y: 0.8 })
      .points,
    0,
  );
  assert.equal(
    scoreAction("aim", challenge, 200, { challengeId: "x" }).points,
    0,
  );
});
test("Speed checks ink, not the decoy word", () => {
  const challenge = {
    id: "x",
    ink: "BLUE",
    word: "GREEN",
    choices: ["BLUE", "GREEN"],
  };
  assert.equal(
    scoreAction("speed", challenge, 200, { challengeId: "x", choice: 1 })
      .points,
    0,
  );
  assert.equal(
    scoreAction("speed", challenge, 200, { challengeId: "x", choice: 0 })
      .points,
    940,
  );
});
test("Precision scores the server timeline", () => {
  assert(Math.abs(markerPosition(400, 1600) - 0.5) < 0.0001);
  assert.equal(
    scoreAction("precision", { id: "x", period: 1600 }, 400, {
      challengeId: "x",
    }).points,
    1000,
  );
  assert.equal(
    scoreAction("precision", { id: "x", period: 1600 }, 800, {
      challengeId: "x",
    }).points,
    0,
  );
});
test("Match rejects spectators, stale rounds, duplicates and out-of-phase actions", async () => {
  let settlements = 0;
  const a = { id: "a", username: "a", accent: "", bio: "" },
    b = { ...a, id: "b", username: "b" };
  const m = new Match(
    [a, b],
    "aim",
    "ranked",
    () => {},
    async () => {
      settlements++;
      return {};
    },
  );
  m.state.phase = "active";
  m.state.challenge = { id: "current", x: 0.5, y: 0.5 };
  m.state.startedAt = Date.now() - 200;
  m.state.deadline = Date.now() + 5000;
  m.action("spectator", { challengeId: "current", x: 0.5, y: 0.5 });
  m.action("a", { challengeId: "old", x: 0.5, y: 0.5 });
  assert.equal(m.state.scores.a, 0);
  m.action("a", { challengeId: "current", x: 0.5, y: 0.5 });
  const score = m.state.scores.a;
  m.action("a", { challengeId: "current", x: 0.5, y: 0.5 });
  assert.equal(m.state.scores.a, score);
  await Promise.all([m.finish(), m.finish()]);
  assert.equal(settlements, 1);
  m.dispose();
});
test("False start locks the player out for that round", () => {
  const a = { id: "a", username: "a", accent: "", bio: "" };
  const m = new Match(
    [a, { ...a, id: "b" }],
    "reaction",
    "casual",
    () => {},
    async () => ({}),
  );
  m.state.phase = "waiting";
  m.state.challenge = { id: "round" };
  m.action("a", { challengeId: "round" });
  assert.deepEqual(m.state.answered, ["a"]);
  assert.match(m.state.feedback.a.detail, /False start/);
  m.dispose();
});
test("PostgreSQL settlement is atomic, exactly once, and survives a restart", async () => {
  mkdirSync(resolve("test-results"), { recursive: true });
  const path = await mkdtemp(resolve("test-results", "persistence-"));
  let db = new Database(undefined, path);
  await db.init();
  const a = newId(),
    b = newId();
  for (const [i, id] of [a, b].entries())
    await db.query(
      "INSERT INTO users(id,username,username_key,email,password_hash) VALUES($1,$2,$2,$3,$4)",
      [
        id,
        `test${i}`,
        `test${i}@example.invalid`,
        await hashPassword("test-password-only"),
      ],
    );
  const m = new Match(
    [(await db.player(a))!, (await db.player(b))!],
    "aim",
    "ranked",
    () => {},
    (s) => db.finishMatch(s),
  );
  m.state.scores[a] = 900;
  m.state.scores[b] = 400;
  await db.beginMatch(m.state);
  await m.finish();
  assert.equal(m.state.changes?.[a], 16);
  await assert.rejects(db.finishMatch(m.state), /already settled/);
  const profile = await db.profile(a);
  assert.equal(profile!.stats.played, 1);
  assert.equal(profile!.rating.rating, 1016);
  await db.close();
  db = new Database(undefined, path);
  await db.init();
  const persisted = await db.profile(a);
  assert.equal(persisted!.history.length, 1);
  assert.equal(persisted!.rating.rating, 1016);
  await db.close();
  m.dispose();
});
