import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import { games, type MatchState, type Player } from "../lib/shared";
import type { MatchFrame } from "../lib/match-feed";

const origin = "http://localhost:3103";
let output = "";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--api-only"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "3103",
      APP_ORIGIN: origin,
      DATA_DIR: resolve("test-results", "experience-" + randomUUID()),
      DATABASE_URL: "",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  },
);
server.stdout!.on("data", (chunk) => (output += chunk));
server.stderr!.on("data", (chunk) => (output += chunk));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, timeout = 15000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error("Timed out: " + output);
    await pause(30);
  }
}
const clients: {
  user: Player;
  cookie: string;
  socket: Socket;
  state?: MatchState;
  frames: number;
  full: number;
  bytes: number;
  baseline: number;
  positions: number[];
}[] = [];
async function request(path: string, body?: unknown, cookie?: string) {
  const r = await fetch(origin + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  assert(r.ok, JSON.stringify(data));
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function create(i: number) {
  const r = await request("/auth/register", {
    username: `ExperienceQA_${i}`,
    email: `experience${i}@example.invalid`,
    password: "experience-test-password",
  });
  const socket = io(origin, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: false,
    auth: { frames: true },
    extraHeaders: { Cookie: r.cookie!, Origin: origin },
  });
  const c: (typeof clients)[number] = {
    user: r.data.player,
    cookie: r.cookie!,
    socket,
    frames: 0,
    full: 0,
    bytes: 0,
    baseline: 0,
    positions: [],
  };
  clients.push(c);
  socket.on("match", (s: MatchState) => {
    c.state = s;
    c.full++;
  });
  socket.on("frame", (f: MatchFrame) => {
    if (c.state?.id !== f.id) return;
    c.state = {
      ...c.state,
      ...f,
      frontier:
        f.frontier && c.state.frontier
          ? { ...c.state.frontier, ...f.frontier }
          : c.state.frontier,
    };
    c.frames++;
    c.bytes += JSON.stringify(f).length;
    c.baseline += JSON.stringify(c.state).length;
    const p = f.competition?.players[c.user.id];
    if (p) c.positions.push(p.x);
  });
  await new Promise<void>((yes, no) => {
    socket.once("connect", yes);
    socket.once("connect_error", no);
    socket.connect();
  });
  return c;
}
type Client = (typeof clients)[number];
const command = (c: Client, event: string, data: unknown = {}) =>
  new Promise<any>((yes, no) =>
    c.socket
      .timeout(15000)
      .emit(event, data, (e: Error | null, result: any) =>
        e || result.error ? no(e || Error(result.error)) : yes(result),
      ),
  );
try {
  await until(async () => {
    try {
      return (await fetch(origin + "/api/health")).ok;
    } catch {
      return false;
    }
  }, 30000);
  const a = await create(1),
    b = await create(2);
  await command(a, "queue:join", { game: "any", mode: "casual" });
  assert.equal((await request("/overview")).data.queued, 1);
  assert.equal(a.state, undefined);
  await command(a, "queue:leave");
  assert.equal((await request("/overview")).data.queued, 0);
  await command(a, "queue:join", { game: "any", mode: "casual" });
  await command(b, "queue:join", { game: "dodge", mode: "casual" });
  await until(() => a.state?.phase === "active" && b.state?.phase === "active");
  assert.equal(a.state!.game, "dodge");
  assert.equal(a.state!.id, b.state!.id);
  console.log(
    "PASS Quick Match cancellation and compatibility with a selected-game queue.",
  );
  const reconnectMatch = b.state!.id,
    reconnectFull = b.full;
  b.socket.disconnect();
  await pause(200);
  await new Promise<void>((yes, no) => {
    b.socket.once("connect", yes);
    b.socket.once("connect_error", no);
    b.socket.connect();
  });
  await until(
    () =>
      b.full > reconnectFull &&
      b.state?.id === reconnectMatch &&
      b.state.phase === "active",
  );
  let seq = 0;
  const start = Date.now();
  const delayed = new Set<ReturnType<typeof setTimeout>>();
  const input = setInterval(() => {
    for (const [i, c] of clients.entries()) {
      if (c.state?.phase !== "active") continue;
      const angle = (Date.now() - start) / 900 + i * Math.PI,
        action = {
          challengeId: c.state.challenge!.id,
          dx: Math.cos(angle),
          dy: Math.sin(angle),
          seq: ++seq,
        };
      const timeout = setTimeout(
        () => {
          delayed.delete(timeout);
          c.socket.volatile.emit("action", action);
        },
        55 + (seq % 7) * 7,
      );
      delayed.add(timeout);
    }
  }, 100);
  await pause(8500);
  clearInterval(input);
  delayed.forEach(clearTimeout);
  for (const c of clients) {
    assert(c.frames >= 65, `${c.frames} frames`);
    assert(c.full < 8, `${c.full} full messages`);
    assert(
      Math.max(...c.positions) - Math.min(...c.positions) > 0.12,
      "both players must move",
    );
    assert(c.bytes < c.baseline * 0.9);
  }
  console.log(
    `PASS two simultaneous moving WebSocket clients with delayed/jittered inputs: ${a.frames}/${b.frames} compact frames; ${(100 * (1 - a.bytes / a.baseline)).toFixed(1)}% fewer bytes than full snapshots.`,
  );
  await command(a, "match:leave");
  await until(
    () => a.state?.phase === "finished" && b.state?.phase === "finished",
  );
  await command(a, "queue:join", { game: "any", mode: "casual" });
  await command(b, "queue:join", { game: "any", mode: "casual" });
  await until(() => a.state?.phase === "intro" && b.state?.id === a.state?.id);
  assert(games.includes(a.state!.game));
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  console.log(
    "PASS two Quick Match players select a real shared random game; reconnect restores the active match.",
  );
  const before = (await request("/profile/" + a.user.id)).data;
  const completed = (await request("/overview")).data.completed;
  for (const difficulty of ["easy", "medium", "hard", "expert"]) {
    await command(a, "ai:start", { game: "clash", difficulty });
    await until(() => a.state?.phase === "active" && a.state.mode === "ai");
    const bot: Player = a.state!.players.find((p) => p.bot)!;
    assert(bot);
    assert.equal(bot.difficulty, difficulty);
    await until(() => a.state!.scores[bot.id] > 0);
    if (difficulty === "expert") {
      await until(() => a.state?.phase === "finished", 60000);
      assert(a.state!.scores[bot.id] > 1000);
      assert.equal(a.state!.rewards, undefined);
      const id = a.state!.id;
      await command(a, "rematch", { id });
      await until(() => a.state?.id !== id && a.state?.mode === "ai");
    }
    await command(a, "match:leave");
    await until(() => a.state?.phase === "finished");
  }
  const after = (await request("/profile/" + a.user.id)).data;
  assert.deepEqual(after.stats, before.stats);
  assert.equal(after.progression.xp, before.progression.xp);
  assert.equal((await request("/overview")).data.completed, completed);
  assert.equal((await request("/overview")).data.online, 2);
  await assert.rejects(
    command(a, "ai:start", { game: "reaction", difficulty: "expert" }),
  );
  await command(a, "queue:join", { game: "any", mode: "casual" });
  a.socket.disconnect();
  await until(async () => (await request("/overview")).data.queued === 0);
  console.log(
    "PASS four AI difficulties, full scored bot match, immediate AI rematch, unsupported modes rejected, zero bot accounts/ranking/XP, disconnect cancels queue.",
  );
} finally {
  clients.forEach((c) => c.socket.disconnect());
  if (server.exitCode === null) {
    const exit = new Promise((r) => server.once("exit", r));
    server.send("duelzone:stop");
    await exit;
  }
}
