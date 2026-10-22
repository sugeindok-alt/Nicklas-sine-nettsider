import test from "node:test";
import assert from "node:assert/strict";
import { Database, newId } from "../server/db";
import { Match } from "../server/game";
import { imageData } from "../server/media";
import { weekAt } from "../lib/progression";
import { compatibleGames } from "../lib/platform";
test("Images reject executable formats; UTC weeks and allowed pools have exact boundaries", () => {
  assert(
    !imageData(1024).safeParse("data:image/svg+xml;base64,PHN2Zz4=").success,
  );
  assert(!imageData(1024).safeParse("data:image/png;base64,PHN2Zz4=").success);
  assert.equal(weekAt(new Date("2026-10-25T23:59:59Z")), "2026-10-19");
  assert.equal(weekAt(new Date("2026-10-26T00:00:00Z")), "2026-10-26");
  assert.deepEqual(compatibleGames("core", "any", [], ["core"]), []);
  assert.deepEqual(compatibleGames("core", "any"), ["core"]);
});
test("Weekly rewards are claimed once, rank history is real and promotions/achievements persist", async () => {
  const db = new Database(undefined, "memory://");
  try {
    await db.init();
    const people = [0, 1].map((n) => ({
      id: newId(),
      username: "Progress" + n,
      accent: "#c8f36a",
      bio: "",
    }));
    for (const p of people)
      await db.query(
        "INSERT INTO users(id,username,username_key,email,password_hash) VALUES($1,$2,$2,$3,$4)",
        [p.id, p.username, p.id + "@example.invalid", "test-only"],
      );
    const season = await db.currentSeason();
    await db.query(
      "INSERT INTO ratings(user_id,season_id,rating) VALUES($1,$2,1049)",
      [people[0].id, season.id],
    );
    for (let i = 0; i < 6; i++) {
      const m = new Match(
        people,
        ["core", "ball", "reaction"][i % 3] as "core",
        "ranked",
        () => {},
        async () => ({}),
      );
      m.state.phase = "finished";
      m.state.winner = people[0].id;
      m.state.reason = "Score";
      m.state.scores = { [people[0].id]: 10, [people[1].id]: 5 };
      await db.beginMatch(m.state);
      await db.finishMatch(m.state);
      await assert.rejects(db.finishMatch(m.state));
    }
    const profile = await db.profile(people[0].id);
    assert.equal(profile!.rankHistory.length, 6);
    assert.equal(
      profile!.progression.weekly?.filter((g) => g.complete).length,
      3,
    );
    assert.equal(
      (
        await db.query("SELECT * FROM weekly_rewards WHERE user_id=$1", [
          people[0].id,
        ])
      ).rows.length,
      3,
    );
    const notes = (
      await db.query<{ kind: string }>(
        "SELECT kind FROM notifications WHERE user_id=$1",
        [people[0].id],
      )
    ).rows;
    assert(notes.some((n) => n.kind === "promotion"));
    assert(notes.some((n) => n.kind === "achievement"));
    assert.equal(notes.filter((n) => n.kind === "weekly").length, 3);
  } finally {
    await db.close();
  }
});
