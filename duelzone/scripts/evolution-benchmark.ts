import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { Frontier } from "../lib/frontier";
import { ReplayRecorder } from "../server/replays";
import type { MatchState } from "../lib/shared";
import { Database, newId } from "../server/db";
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timings: {
  game: string;
  baselineMs: number;
  updatedMs: number;
  savingPercent: number;
}[] = [];
for (const game of ["grapple", "core"] as const) {
  const engine = new Frontier(game, ["a", "b"], 0, () => 0.5);
  const base = {
    game,
    phase: "active",
    players: [],
    scores: { a: 0, b: 0 },
  } as unknown as MatchState;
  const measure = (old: boolean) => {
    const recorder = new ReplayRecorder(),
      start = performance.now();
    for (let i = 0; i < 600; i++) {
      engine.view.now = i * 66.6667;
      const state = { ...base, frontier: engine.snapshot() };
      if (old) {
        for (const id of ["a", "b"]) {
          engine.snapshot(id);
          engine.snapshot(id);
        }
      } else recorder.capture(state);
    }
    return performance.now() - start;
  };
  measure(true);
  measure(false);
  const before = [],
    after = [];
  for (let i = 0; i < 11; i++) {
    before.push(measure(true));
    after.push(measure(false));
  }
  const baselineMs = median(before),
    updatedMs = median(after);
  timings.push({
    game,
    baselineMs: +baselineMs.toFixed(2),
    updatedMs: +updatedMs.toFixed(2),
    savingPercent: +((1 - updatedMs / baselineMs) * 100).toFixed(1),
  });
}
const db = new Database(undefined, "memory://");
await db.init();
let baselineQueries = 0,
  updatedQueries = 0;
try {
  const user = newId();
  await db.query(
    "INSERT INTO users(id,username,username_key,email,password_hash) VALUES($1,'Bench','bench','bench@example.invalid','unused')",
    [user],
  );
  for (let i = 0; i < 30; i++)
    await db.query(
      "INSERT INTO tournaments(id,name,game,host_id) VALUES($1,$2,'aim',$3)",
      [newId(), "Benchmark " + i, user],
    );
  const original = db.query.bind(db);
  let count = 0;
  db.query = (async (...args: Parameters<typeof db.query>) => {
    count++;
    return original(...args);
  }) as typeof db.query;
  const list = (
    await db.query(
      "SELECT id FROM tournaments ORDER BY created_at DESC LIMIT 30",
    )
  ).rows;
  for (const t of list) {
    await db.query(
      "SELECT u.id,u.username,u.accent FROM entrants e JOIN users u ON u.id=e.user_id WHERE tournament_id=$1 ORDER BY joined_at",
      [t.id],
    );
    await db.query(
      "SELECT f.* FROM fixtures f WHERE tournament_id=$1 ORDER BY round,slot",
      [t.id],
    );
  }
  baselineQueries = count;
  count = 0;
  await db.tournaments();
  updatedQueries = count;
} finally {
  await db.close();
}
const result = {
  method:
    "Median of 11 runs, 600 two-player snapshot preparations. Updated path includes replay capture; excludes physics, serialization, network and browser rendering. Same process and engine state. Query counts measured with 30 isolated tournaments.",
  timings,
  tournamentQueries: { baseline: baselineQueries, updated: updatedQueries },
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/evolution-performance.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
