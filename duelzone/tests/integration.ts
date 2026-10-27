import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { games, type Game, type MatchState, type Player } from "../lib/shared";

const port = Number(process.env.TEST_PORT || 3101),
  origin = `http://localhost:${port}`;
const directory = resolve("test-results", `integration-${randomUUID()}`);
mkdirSync(directory, { recursive: true });
const clients: Client[] = [];
let output = "";
function boot() {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts", "--api-only"],
    {
      env: {
        ...process.env,
        PORT: String(port),
        APP_ORIGIN: origin,
        DATA_DIR: directory,
        DATABASE_URL: "",
        NODE_ENV: "development",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout!.on("data", (d) => {
    output += d;
  });
  child.stderr!.on("data", (d) => {
    output += d;
  });
  return child;
}
let server: ChildProcess = boot();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ready() {
  for (let n = 0; n < 60; n++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Server did not start: ${output}`);
}
async function stop() {
  if (server.exitCode !== null) return;
  const exit = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  await exit;
}
async function request(
  path: string,
  body?: unknown,
  cookie?: string,
  method?: string,
  customOrigin = origin,
) {
  const response = await fetch(`${origin}/api${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Origin: customOrigin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
class Client {
  socket: Socket;
  states: MatchState[] = [];
  user: Player;
  cookie: string;
  constructor(user: Player, cookie: string) {
    this.user = user;
    this.cookie = cookie;
    this.socket = io(origin, {
      transports: ["websocket"],
      extraHeaders: { Cookie: cookie, Origin: origin },
      autoConnect: false,
    });
    this.socket.on("match", (s) => {
      this.states.push(s);
    });
    clients.push(this);
  }
  async connect() {
    const wait = new Promise<void>((res, rej) => {
      this.socket.once("connect", () => res());
      this.socket.once("connect_error", rej);
    });
    this.socket.connect();
    await wait;
    return this;
  }
  command(name: string, data: unknown = {}) {
    return new Promise<any>((resolve, reject) =>
      this.socket
        .timeout(10000)
        .emit(name, data, (err: Error | null, result: any) => {
          if (err || result.error) reject(err || new Error(result.error));
          else resolve(result);
        }),
    );
  }
  async state(predicate: (s: MatchState) => boolean, timeout = 60000) {
    const existing = [...this.states].reverse().find(predicate);
    if (existing) return existing;
    return new Promise<MatchState>((resolve, reject) => {
      const listener = (s: MatchState) => {
        if (predicate(s)) {
          clearTimeout(timer);
          this.socket.off("match", listener);
          resolve(s);
        }
      };
      const timer = setTimeout(() => {
        this.socket.off("match", listener);
        reject(new Error(`Timed out waiting for ${this.user.username}`));
      }, timeout);
      this.socket.on("match", listener);
    });
  }
  autoPlay(delay = 170) {
    const seen = new Set<string>();
    const play = (s: MatchState) => {
      if (s.phase !== "active" || seen.has(s.challenge!.id)) return;
      seen.add(s.challenge!.id);
      const action = {
        challengeId: s.challenge!.id,
        x: s.challenge?.x,
        y: s.challenge?.y,
        choice: s.challenge?.choices?.indexOf(s.challenge.ink!),
      };
      setTimeout(
        () => this.socket.emit("action", action),
        s.game === "precision" ? s.challenge!.period! / 4 + delay / 8 : delay,
      );
    };
    this.socket.on("match", play);
    return () => this.socket.off("match", play);
  }
}
async function register(index: number) {
  const result = await request("/auth/register", {
    username: `QA_Player_${index}`,
    email: `qa${index}@example.invalid`,
    password: "QA-only-password-981!",
  });
  assert.equal(result.status, 201, result.data.error);
  assert(result.cookie);
  return new Client(result.data.player, result.cookie!).connect();
}
let checks = 0;
const pass = (name: string) => {
  checks++;
  console.log(`PASS ${checks}: ${name}`);
};
try {
  await ready();
  assert.equal(
    (
      await request("/auth/register", {
        username: "invalid",
        email: "bad",
        password: "short",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/auth/register",
        {
          username: "crosssite",
          email: "x@example.invalid",
          password: "safe-password-123",
        },
        undefined,
        undefined,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/profile",
        { bio: "bad", accent: "#c8f36a" },
        undefined,
        "PATCH",
      )
    ).status,
    401,
  );
  pass("Input validation, CSRF origin and anonymous write protection");
  const people: Client[] = [];
  for (let i = 0; i < 12; i++) people.push(await register(i));
  assert.equal(
    (
      await request("/auth/login", {
        email: "qa0@example.invalid",
        password: "wrong-password",
      })
    ).status,
    401,
  );
  pass("Twelve independent authenticated WebSocket sessions");
  const unauthorized = io(origin, {
    transports: ["websocket"],
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    unauthorized.on("connect", () =>
      reject(new Error("Anonymous socket accepted")),
    );
    unauthorized.on("connect_error", () => resolve());
  });
  unauthorized.disconnect();
  pass("Anonymous WebSocket rejected");
  const [a, b] = people;
  await a.command("queue:join", { game: "aim", mode: "ranked" });
  await b.command("queue:join", { game: "reaction", mode: "ranked" });
  await sleep(700);
  assert.equal(a.states.length, 0);
  assert.equal(b.states.length, 0);
  await a.command("queue:leave");
  await b.command("queue:leave");
  pass("Different games do not match and there are no fabricated opponents");
  await Promise.all(
    games
      .filter((game) =>
        ["reaction", "aim", "speed", "precision"].includes(game),
      )
      .map(async (game, i) => {
        const p = people[i * 2],
          q = people[i * 2 + 1];
        const offP = p.autoPlay(150),
          offQ = q.autoPlay(350);
        await p.command("queue:join", {
          game,
          mode: i === 0 ? "ranked" : "casual",
        });
        await q.command("queue:join", {
          game,
          mode: i === 0 ? "ranked" : "casual",
        });
        const state = await p.state(
          (s) => s.game === game && s.phase === "intro",
        );
        assert(
          (await q.state((s) => s.id === state.id)).players.some(
            (x) => x.id === p.user.id,
          ),
        );
        p.socket.emit("action", { challengeId: randomUUID(), points: 999999 });
        const result = await p.state(
          (s) => s.id === state.id && s.phase === "finished",
          90000,
        );
        const other = await q.state(
          (s) => s.id === state.id && s.phase === "finished",
        );
        assert.deepEqual(result.scores, other.scores);
        assert.equal(result.winner, p.user.id);
        const profile = (await request(`/profile/${p.user.id}`)).data;
        assert.equal(profile.stats.played, 1);
        assert(profile.history[0].score < 10000);
        offP();
        offQ();
        pass(
          `${game}: synchronized 1v1, authoritative scores and saved result`,
        );
      }),
  );
  const first = (await request(`/profile/${a.user.id}`)).data;
  assert.equal(first.rating.rating, 1016);
  assert.equal((await request("/leaderboard")).data.rows.length, 2);
  pass("Only ranked matches update Elo and the leaderboard");
  const invitation = await a.command("invite:create", { game: "aim" });
  await assert.rejects(
    a.command("invite:join", { code: invitation.code }),
    /friend/,
  );
  await b.command("invite:join", { code: invitation.code });
  const friend = await a.state(
    (s) => s.mode === "friend" && s.phase === "intro",
  );
  await a.command("match:leave");
  await b.state((s) => s.id === friend.id && s.phase === "finished");
  await assert.rejects(
    people[2].command("invite:join", { code: invitation.code }),
    /expired/,
  );
  pass("Friend invite, self-invite rejection, single use and forfeit");
  await a.command("rematch", { id: friend.id });
  await b.command("rematch", { id: friend.id });
  const rematch = await a.state(
    (s) => s.mode === "friend" && s.phase === "intro" && s.id !== friend.id,
  );
  a.socket.disconnect();
  await a.connect();
  assert.equal((await a.state((s) => s.id === rematch.id)).id, rematch.id);
  await b.command("match:leave");
  await a.state((s) => s.id === rematch.id && s.phase === "finished");
  pass("Mutual rematch and reconnect restore the same match");
  const host = people[8],
    entrants = people.slice(8);
  const t = (
    await request(
      "/tournaments",
      { name: "QA Knockout", game: "aim" },
      host.cookie,
    )
  ).data;
  for (const p of entrants.slice(1))
    assert.equal(
      (await request(`/tournaments/${t.id}/join`, {}, p.cookie)).status,
      200,
    );
  assert.equal(
    (await request(`/tournaments/${t.id}/join`, {}, a.cookie)).status,
    409,
  );
  const stops = entrants.map((p, i) => p.autoPlay(150 + i * 90));
  for (const p of entrants)
    await p.command("tournament:ready", { id: t.id, ready: true });
  await host.command("tournament:start", { id: t.id });
  const semifinal = await host.state(
    (s) => s.mode === "tournament" && s.phase === "finished",
    60000,
  );
  const final = await host.state(
    (s) =>
      s.mode === "tournament" &&
      s.phase === "finished" &&
      s.id !== semifinal.id,
    60000,
  );
  assert.equal(final.winner, host.user.id);
  await sleep(300);
  const tournament = (await request("/tournaments")).data.tournaments.find(
    (x: any) => x.id === t.id,
  );
  assert.equal(tournament.status, "finished");
  assert.equal(tournament.fixtures.length, 3);
  assert.equal(tournament.winner, host.user.username);
  stops.forEach((stop) => stop());
  pass(
    "Four-player tournament runs semifinals and final with persisted bracket",
  );
  assert.equal(
    (
      await request(
        "/profile",
        { bio: "Verified test bio", accent: "#a5bce9" },
        a.cookie,
        "PATCH",
      )
    ).status,
    200,
  );
  const before = (await request(`/profile/${a.user.id}`)).data;
  clients.forEach((c) => c.socket.disconnect());
  await stop();
  server = boot();
  await ready();
  const after = (await request(`/profile/${a.user.id}`)).data;
  assert.deepEqual(after.stats, before.stats);
  assert.equal(after.player.bio, "Verified test bio");
  assert.equal(after.rating.rating, before.rating.rating);
  assert.equal(
    (await request("/me", undefined, a.cookie)).data.player.id,
    a.user.id,
  );
  pass("Database, profile, ranking and sessions survive server restart");
  assert.equal((await request("/auth/logout", {}, a.cookie)).status, 200);
  assert.equal((await request("/me", undefined, a.cookie)).data.player, null);
  pass("Logout revokes the server session");
  console.log(
    `\n${checks} integration checks passed. Test data isolated at ${directory}`,
  );
} catch (error) {
  console.error(error);
  console.error(output.slice(-6000));
  process.exitCode = 1;
} finally {
  clients.forEach((c) => c.socket.disconnect());
  await stop();
}
