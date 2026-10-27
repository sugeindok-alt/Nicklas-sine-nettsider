import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import {
  featuredGames,
  type MatchState,
  type Game,
  type Player,
} from "../lib/shared";
const origin = "http://localhost:3102",
  directory = resolve("test-results", "live-" + randomUUID());
mkdirSync(directory, { recursive: true });
let output = "",
  server: ChildProcess;
const clients: {
  user: Player;
  cookie: string;
  socket: Socket;
  state?: MatchState;
  memories: Map<string, number[]>;
  capturedGridTile: boolean;
}[] = [];
const timers: ReturnType<typeof setInterval>[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function boot() {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts", "--api-only"],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "3102",
        APP_ORIGIN: origin,
        DATA_DIR: directory,
        DATABASE_URL: "",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  child.stdout!.on("data", (chunk) => (output += chunk));
  child.stderr!.on("data", (chunk) => (output += chunk));
  return child;
}
async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await sleep(250);
  }
  throw Error(output);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise((resolve) => server.once("exit", resolve));
  server.send("duelzone:stop");
  await done;
}
async function request(route: string, body?: unknown, cookie?: string) {
  const response = await fetch(origin + "/api" + route, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function create(index: number) {
  const result = await request("/auth/register", {
    username: "LiveQA_" + index,
    email: `live${index}@example.invalid`,
    password: "live-test-password-only",
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const socket = io(origin, {
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
    extraHeaders: { Origin: origin, Cookie: result.cookie! },
  });
  const client: (typeof clients)[number] = {
    user: result.data.player,
    cookie: result.cookie!,
    socket,
    memories: new Map(),
    capturedGridTile: false,
  };
  clients.push(client);
  socket.on("match", (state: MatchState) => {
    client.state = state;
    if (
      state.competition?.discipline === "grid" &&
      state.competition.players[client.user.id]?.energy > 0
    )
      client.capturedGridTile = true;
    const p = state.competition?.puzzle;
    if (p?.sequence.length) client.memories.set(p.id, p.sequence);
  });
  await connect(client);
  return client;
}
async function connect(c: (typeof clients)[number]) {
  await new Promise<void>((resolve, reject) => {
    c.socket.once("connect", resolve);
    c.socket.once("connect_error", reject);
    c.socket.connect();
  });
}
function command(c: (typeof clients)[number], name: string, data: unknown) {
  return new Promise<any>((resolve, reject) =>
    c.socket
      .timeout(10000)
      .emit(name, data, (error: Error | null, result: any) =>
        error || result.error
          ? reject(error || new Error(result.error))
          : resolve(result),
      ),
  );
}
async function until(check: () => boolean, timeout = 115000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout)
      throw Error("Timed out waiting for live match");
    await sleep(60);
  }
}
function play(c: (typeof clients)[number], index: number) {
  timers.push(
    setInterval(
      () => {
        const s = c.state,
          v = s?.competition,
          p = v?.players[c.user.id];
        if (!s || !v || !p || s.phase !== "active" || v.transitionUntil > v.now)
          return;
        const base = { challengeId: s.challenge!.id, puzzleId: v.puzzle?.id };
        if (v.discipline === "dodge") {
          const closest = v.hazards
            .filter((h) => h.activeAt <= v.now)
            .sort(
              (a, b) =>
                Math.hypot(a.x - p.x, a.y - p.y) -
                Math.hypot(b.x - p.x, b.y - p.y),
            )[0];
          const awayX =
            closest && Math.hypot(closest.x - p.x, closest.y - p.y) < 0.2
              ? (p.x - closest.x) * 8
              : (0.5 - p.x) * 3;
          const awayY =
            closest && Math.hypot(closest.x - p.x, closest.y - p.y) < 0.2
              ? (p.y - closest.y) * 8
              : (0.5 - p.y) * 3;
          c.socket.emit("action", {
            ...base,
            dx: Math.max(-1, Math.min(1, awayX)),
            dy: Math.max(-1, Math.min(1, awayY)),
          });
          if (closest && Math.hypot(closest.x - p.x, closest.y - p.y) < 0.12)
            c.socket.emit("action", { ...base, ability: true });
        } else if (v.discipline === "grid") {
          const tiles = v.tiles
            .map((owner, tile) => ({ owner, tile }))
            .filter(
              ({ owner, tile }) =>
                owner !== c.user.id &&
                (v.fortified[tile] || 0) <= v.now &&
                [
                  tile - 7,
                  tile + 7,
                  ...(tile % 7 ? [tile - 1] : []),
                  ...(tile % 7 < 6 ? [tile + 1] : []),
                ].some((n) => n >= 0 && n < 49 && v.tiles[n] === c.user.id),
            );
          tiles.sort(
            (a, b) =>
              Math.abs(a.tile - v.bonusTile) - Math.abs(b.tile - v.bonusTile),
          );
          if (tiles.length)
            c.socket.emit("action", { ...base, tile: tiles[0].tile });
        } else if (v.discipline === "clash") {
          const targets = v.targets.filter((t) => t.kind !== "decoy"),
            t = targets[index % targets.length];
          if (t)
            c.socket.emit("action", { ...base, x: t.x, y: t.y, target: t.id });
        } else if (v.puzzle && v.now >= v.puzzle.revealUntil && !p.solved) {
          const puzzle = v.puzzle;
          if (puzzle.kind === "memory") {
            const sequence = c.memories.get(puzzle.id);
            if (sequence)
              c.socket.emit("action", { ...base, tile: sequence[p.progress] });
          } else {
            const numbers = puzzle.prompt.match(/\d+/g)!.map(Number);
            const answer =
              puzzle.kind === "logic"
                ? numbers[0] * numbers[1] - numbers[2]
                : puzzle.number > 3
                  ? numbers[2] * 2
                  : numbers[2] + numbers[1] - numbers[0];
            c.socket.emit("action", {
              ...base,
              choice: puzzle.choices.indexOf(String(answer)),
            });
          }
        }
      },
      index % 2 ? 230 : 170,
    ),
  );
}
try {
  server = boot();
  await ready();
  for (let i = 0; i < 10; i++) await create(i);
  console.log("PASS ten authenticated WebSocket clients");
  await Promise.all(
    featuredGames.map(async (game: Game, index) => {
      const [a, b] = clients.slice(index * 2, index * 2 + 2);
      play(a, index * 2);
      play(b, index * 2 + 1);
      if (game === "grid") {
        const invite = await command(a, "invite:create", { game });
        await command(b, "invite:join", { code: invite.code });
      } else {
        await command(a, "queue:join", { game, mode: "ranked" });
        await command(b, "queue:join", { game, mode: "ranked" });
      }
      await until(() => a.state?.phase === "active" && !!a.state.competition);
      if (game === "clash") {
        a.socket.disconnect();
        await sleep(250);
        await connect(a);
        await until(() => a.socket.connected);
        console.log("PASS live reconnect restores Aim Clash");
      }
      await until(
        () => a.state?.phase === "finished" && b.state?.phase === "finished",
      );
      const x = a.state!,
        y = b.state!;
      assert.equal(x.id, y.id);
      assert.deepEqual(x.scores, y.scores);
      if (game === "grid") {
        assert(a.capturedGridTile && b.capturedGridTile);
        for (const c of [a, b]) {
          assert(Number.isFinite(x.scores[c.user.id]));
          assert(x.scores[c.user.id] >= 0);
        }
        assert(x.scores[a.user.id] + x.scores[b.user.id] > 0);
      } else {
        assert(x.scores[a.user.id] > 0);
        assert(x.scores[b.user.id] > 0);
      }
      const profile = (await request("/profile/" + a.user.id)).data;
      assert(profile.history.some((h: any) => h.id === x.id));
      assert(profile.progression.xp > 0);
      if (game !== "grid") assert.equal(profile.rating.games, 1);
      console.log(
        `PASS ${game}: complete two-player match, matching results, saved progression and rankings`,
      );
    }),
  );
  timers.forEach(clearInterval);
  const [a, b] = clients.slice(2, 4),
    old = a.state!.id;
  await command(a, "rematch", { id: old });
  await command(b, "rematch", { id: old });
  await until(() => !!a.state && a.state.id !== old);
  const xp = (await request("/profile/" + a.user.id)).data.progression.xp;
  await command(a, "match:leave", {});
  await until(() => a.state?.phase === "finished");
  assert.equal(
    (await request("/profile/" + a.user.id)).data.progression.xp,
    xp,
  );
  console.log("PASS mutual rematch and forfeit grants no XP");
  const before = (await request("/profile/" + a.user.id)).data;
  clients.forEach((c) => c.socket.disconnect());
  await stop();
  server = boot();
  await ready();
  const after = (await request("/profile/" + a.user.id)).data;
  assert.deepEqual(after.progression, before.progression);
  assert.deepEqual(after.stats, before.stats);
  assert.equal(
    (await request("/me", undefined, a.cookie)).data.player.id,
    a.user.id,
  );
  console.log(
    "PASS accounts, achievements, daily rewards, ratings and results survive restart",
  );
} catch (error) {
  console.error(error);
  console.error(output.slice(-5000));
  process.exitCode = 1;
} finally {
  timers.forEach(clearInterval);
  clients.forEach((c) => c.socket.disconnect());
  await stop();
}
