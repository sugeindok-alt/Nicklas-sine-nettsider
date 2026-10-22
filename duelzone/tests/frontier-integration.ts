import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { frontierGames } from "../lib/frontier";
import { FrontierBot } from "../lib/frontier-bot";
import type { MatchState, Player } from "../lib/shared";
const origin = "http://localhost:3105",
  directory = resolve("test-results", "frontier-" + randomUUID());
mkdirSync(directory, { recursive: true });
let output = "";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--api-only"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "3105",
      APP_ORIGIN: origin,
      DATABASE_URL: "",
      DATA_DIR: directory,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  },
);
server.stdout!.on("data", (b) => (output += b));
server.stderr!.on("data", (b) => (output += b));
type Client = {
  user: Player;
  cookie: string;
  socket: Socket;
  state?: MatchState;
  frames: number;
  positions: number[];
  driver: FrontierBot;
  rounds: Set<number>;
};
const clients: Client[] = [],
  delayed = new Set<ReturnType<typeof setTimeout>>();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, timeout = 20000) {
  const start = Date.now();
  while (!(await fn())) {
    assert(Date.now() - start < timeout, "Timed out: " + output);
    await pause(50);
  }
}
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
function command(c: Client, event: string, data: unknown = {}) {
  return new Promise<any>((yes, no) =>
    c.socket
      .timeout(10000)
      .emit(event, data, (error: Error | null, result: any) =>
        error || result.error ? no(error || Error(result.error)) : yes(result),
      ),
  );
}
async function connect(c: Client) {
  await new Promise<void>((yes, no) => {
    c.socket.once("connect", yes);
    c.socket.once("connect_error", no);
    c.socket.connect();
  });
}
let timer: ReturnType<typeof setInterval> | undefined;
try {
  await until(async () => {
    try {
      return (await fetch(origin + "/api/health")).ok;
    } catch {
      return false;
    }
  }, 40000);
  for (let i = 0; i < 12; i++) {
    const r = await request("/auth/register", {
      username: `ExpansionQA_${i}`,
      email: `expansion${i}@example.invalid`,
      password: "expansion-local-test-only",
    });
    const socket = io(origin, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      auth: { frames: true },
      extraHeaders: { Origin: origin, Cookie: r.cookie! },
    });
    const c: Client = {
      user: r.data.player,
      cookie: r.cookie!,
      socket,
      frames: 0,
      positions: [],
      driver: new FrontierBot(r.data.player.id, i % 2 ? "medium" : "hard"),
      rounds: new Set(),
    };
    clients.push(c);
    socket.on("match", (s: MatchState) => {
      c.state = s;
    });
    socket.on("frame", (f) => {
      if (
        c.state &&
        c.state.id === f.id &&
        c.state.phase === "active" &&
        f.serverNow > c.state.serverNow
      ) {
        c.state = {
          ...c.state,
          ...f,
          frontier: { ...c.state.frontier, ...f.frontier },
        };
        c.frames++;
        const v = c.state!.frontier!;
        c.positions.push(v.players[c.user.id].x);
        c.rounds.add(v.round);
      }
    });
    await connect(c);
  }
  timer = setInterval(() => {
    for (const c of clients) {
      const s = c.state;
      if (s?.phase !== "active" || !s.frontier || !s.challenge) continue;
      const input = c.driver.think(s.frontier, Date.now());
      if (!input || input.seq % 29 === 0) continue;
      const action = { challengeId: s.challenge.id, ...input };
      const handle = setTimeout(
        () => {
          delayed.delete(handle);
          if (c.socket.connected) c.socket.emit("action", action);
        },
        35 + (input.seq % 7) * 10,
      );
      delayed.add(handle);
    }
  }, 50);
  await Promise.all(
    frontierGames.map(async (game, i) => {
      const a = clients[i * 2],
        b = clients[i * 2 + 1];
      if (game === "showdown") {
        await command(a, "social:request", { target: b.user.id });
        await command(b, "social:respond", { target: a.user.id, accept: true });
        await command(a, "social:challenge", {
          target: b.user.id,
          game,
          rules: { length: "standard", spectators: false },
        });
        const social = (await command(b, "social:state")).social;
        await command(b, "social:challenge:respond", {
          challengeId: social.challenges.find(
            (x: any) => x.status === "pending",
          ).id,
          accept: true,
        });
      } else {
        await command(a, "queue:join", { game, mode: "casual" });
        await command(b, "queue:join", { game, mode: "casual" });
      }
      await until(
        () => a.state?.phase === "active" && b.state?.phase === "active",
      );
      assert.equal(a.state!.id, b.state!.id);
      if (game === "core") {
        await pause(5000);
        b.socket.disconnect();
        await pause(500);
        await connect(b);
        await until(() => b.state?.phase === "active");
      }
      await until(
        () => a.state?.phase === "finished" && b.state?.phase === "finished",
        170000,
      );
      assert.deepEqual(a.state!.scores, b.state!.scores);
      assert(a.frames > 35 && b.frames > 35);
      for (const c of [a, b])
        assert(
          Math.max(...c.positions) - Math.min(...c.positions) > 40,
          "both players must move",
        );
      const history = (
        await request("/profile/" + a.user.id)
      ).data.history.find((h: any) => h.id === a.state!.id);
      assert(
        history && history.details.length > 0,
        "completed round statistics persist",
      );
      if (game === "showdown") {
        assert(history.details.length >= 3 && history.details.length <= 5);
        assert(a.rounds.size >= 3);
      }
      console.log(
        `PASS ${game}: full match, two moving clients, delayed/jittered inputs and dropped input samples, ${a.frames}/${b.frames} frames, saved result and round statistics.`,
      );
    }),
  );
  const a = clients[10],
    b = clients[11],
    old = a.state!.id;
  await command(a, "rematch", { id: old });
  await command(b, "rematch", { id: old });
  await until(() => a.state?.id !== old && a.state?.phase === "active");
  assert.equal(a.state!.game, "showdown");
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  await command(a, "ai:start", { game: "ball", difficulty: "expert" });
  await until(() => a.state?.phase === "active" && a.state?.mode === "ai");
  const bot = a.state!.players.find((p) => p.bot)!;
  assert(bot && bot.difficulty === "expert");
  await pause(6000);
  assert(a.state!.frontier!.players[bot.id].lastInput > a.state!.startedAt);
  await command(a, "match:leave");
  console.log(
    "PASS friend challenge → Showdown → complete series → mutual rematch; reconnect and authenticated AI practice.",
  );
  writeFileSync(
    resolve("test-results", "frontier-latest.json"),
    JSON.stringify({
      directory,
      users: clients.slice(0, 2).map((c) => ({
        username: c.user.username,
        password: "expansion-local-test-only",
      })),
    }),
  );
} finally {
  clearInterval(timer);
  delayed.forEach(clearTimeout);
  clients.forEach((c) => c.socket.disconnect());
  if (server.exitCode === null) {
    const exit = new Promise((r) => server.once("exit", r));
    server.send("duelzone:stop");
    await exit;
  }
}
