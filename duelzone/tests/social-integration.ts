import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Database } from "../server/db";
import { defaultPrivacy, type SocialState } from "../lib/social";
import type { MatchState, Player } from "../lib/shared";

const origin = "http://localhost:3104",
  directory = resolve("test-results", "social-" + randomUUID());
let server: ChildProcess,
  output = "";
const clients: {
  user: Player;
  cookie: string;
  socket: Socket;
  state?: MatchState;
  watch?: MatchState;
  presence: any[];
  notices: any[];
}[] = [];
type Client = (typeof clients)[number];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, timeout = 15000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error("Timed out: " + output);
    await pause(35);
  }
}
async function start() {
  server = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts", "--api-only"],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "3104",
        APP_ORIGIN: origin,
        DATA_DIR: directory,
        DATABASE_URL: "",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  server.stdout!.on("data", (c) => (output += c));
  server.stderr!.on("data", (c) => (output += c));
  await until(async () => {
    try {
      return (await fetch(origin + "/api/health")).ok;
    } catch {
      return false;
    }
  }, 30000);
}
async function stop() {
  clients.forEach((c) => c.socket.disconnect());
  if (server?.exitCode === null) {
    const exit = new Promise((r) => server.once("exit", r));
    server.send("duelzone:stop");
    await exit;
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
async function connect(c: Client) {
  await new Promise<void>((yes, no) => {
    c.socket.once("connect", yes);
    c.socket.once("connect_error", no);
    c.socket.connect();
  });
}
async function create(n: number) {
  const r = await request("/auth/register", {
    username: `SocialQA_${n}`,
    email: `social${n}@example.invalid`,
    password: "social-test-password",
  });
  const socket = io(origin, {
    autoConnect: false,
    transports: ["websocket"],
    reconnection: false,
    auth: { frames: true },
    extraHeaders: { Cookie: r.cookie!, Origin: origin },
  });
  const c: Client = {
    user: r.data.player,
    cookie: r.cookie!,
    socket,
    presence: [],
    notices: [],
  };
  socket.on("match", (s) => (c.state = s));
  socket.on("frame", (f) => {
    if (c.state?.id === f.id) c.state = { ...c.state, ...f };
  });
  socket.on("spectate", (s) => (c.watch = s));
  socket.on("social:presence", (p) => c.presence.push(p));
  socket.on("social:notice", (p) => c.notices.push(p));
  clients.push(c);
  await connect(c);
  return c;
}
const command = (c: Client, event: string, data: unknown = {}) =>
  new Promise<any>((yes, no) =>
    c.socket
      .timeout(15000)
      .emit(event, data, (error: Error | null, r: any) =>
        error || r.error ? no(error || Error(r.error)) : yes(r),
      ),
  );
const state = async (c: Client): Promise<SocialState> =>
  (await command(c, "social:state")).social;
async function friend(a: Client, b: Client) {
  await command(a, "social:request", { target: b.user.id });
  await command(b, "social:respond", { target: a.user.id, accept: true });
}
const rejected = (c: Client, event: string, data: unknown) =>
  assert.rejects(command(c, event, data));
try {
  await start();
  const a = await create(1),
    b = await create(2),
    c = await create(3),
    d = await create(4);
  assert.equal(
    (await command(a, "social:search", { query: "socialqa_2" })).players[0].id,
    b.user.id,
  );
  assert.equal(
    (await command(a, "social:search", { query: "SocialQA" })).players.length,
    3,
  );
  await rejected(a, "social:request", { target: a.user.id });
  await command(a, "social:request", { target: b.user.id });
  await rejected(a, "social:request", { target: b.user.id });
  await rejected(b, "social:request", { target: a.user.id });
  await rejected(a, "social:respond", { target: b.user.id, accept: true });
  await rejected(c, "social:respond", { target: a.user.id, accept: true });
  assert.equal((await state(b)).requests[0].from_id, a.user.id);
  await command(b, "social:respond", { target: a.user.id, accept: true });
  assert.equal((await state(a)).friends[0].presence, "online");
  await friend(c, a);
  await command(d, "social:request", { target: a.user.id });
  await command(a, "social:respond", { target: d.user.id, accept: false });
  assert.equal((await state(d)).requests.length, 0);
  console.log(
    "PASS username search, permanent mutual friendship, duplicate/self/forged request rejection, decline and live notifications.",
  );
  const messageId = randomUUID(),
    body = "Hello <script>alert('no')</script> & good luck!";
  await command(a, "social:send", { target: b.user.id, body, messageId });
  await command(a, "social:send", { target: b.user.id, body, messageId });
  assert.equal(
    (await command(b, "social:messages", { target: a.user.id })).messages
      .length,
    1,
  );
  assert.equal((await state(b)).friends[0].unread, 1);
  await rejected(c, "social:messages", { target: b.user.id });
  await rejected(a, "social:send", {
    target: b.user.id,
    body: "x".repeat(1001),
    messageId: randomUUID(),
  });
  await command(b, "social:read", { target: a.user.id });
  assert.equal((await state(b)).friends[0].unread, 0);
  await command(b, "social:settings", {
    ...defaultPrivacy,
    messages: false,
    presence: false,
  });
  await rejected(a, "social:send", {
    target: b.user.id,
    body: "blocked by privacy",
    messageId: randomUUID(),
  });
  assert.equal(
    (await state(a)).friends.find((f) => f.id === b.user.id)!.presence,
    "hidden",
  );
  await command(b, "social:settings", defaultPrivacy);
  b.socket.disconnect();
  await until(() =>
    a.presence.some((p) => p.id === b.user.id && p.presence === "offline"),
  );
  await command(a, "social:send", {
    target: b.user.id,
    body: "Waiting offline",
    messageId: randomUUID(),
  });
  await rejected(a, "social:challenge", { target: b.user.id, game: "dodge" });
  await connect(b);
  assert.equal((await state(b)).friends[0].unread, 1);
  assert.equal(
    (await command(b, "social:messages", { target: a.user.id })).messages
      .length,
    2,
  );
  console.log(
    "PASS private messaging, idempotent sends, unread/read state, offline delivery, hidden presence, privacy and unauthorized access checks.",
  );
  await command(a, "social:challenge", {
    target: b.user.id,
    game: "clash",
    rules: { length: "quick", spectators: false },
  });
  const invite = (await state(b)).challenges[0];
  await rejected(a, "social:challenge", { target: b.user.id, game: "dodge" });
  await rejected(c, "social:challenge:respond", {
    challengeId: invite.id,
    accept: true,
  });
  await rejected(a, "social:challenge:respond", {
    challengeId: invite.id,
    accept: true,
  });
  const attempts = await Promise.allSettled([
    command(b, "social:challenge:respond", {
      challengeId: invite.id,
      accept: true,
    }),
    command(b, "social:challenge:respond", {
      challengeId: invite.id,
      accept: true,
    }),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  await until(() => a.state?.phase === "active" && b.state?.phase === "active");
  assert.equal(a.state!.id, b.state!.id);
  assert.equal(a.state!.rules!.length, "quick");
  assert.equal(
    a.state!.competition!.stageEnds - a.state!.competition!.startedAt,
    30000,
  );
  await until(() =>
    c.presence.some((p) => p.id === a.user.id && p.presence === "in-match"),
  );
  await rejected(c, "social:watch", { target: a.user.id });
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  const result = await command(a, "social:profile", { target: b.user.id });
  assert.equal(result.rivalry.losses, 1);
  assert.equal(result.rivalry.played, 1);
  const matchId = a.state!.id;
  await command(a, "rematch", { id: matchId });
  await command(b, "rematch", { id: matchId });
  await until(() => a.state?.id !== matchId && b.state?.id === a.state?.id);
  assert.equal(a.state!.rules!.length, "quick");
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  console.log(
    "PASS friend-to-challenge-to-match flow, forged/duplicate accept rejection, real custom length, in-match presence, rematch rules and head-to-head results.",
  );
  await pause(10000);
  await command(a, "social:settings", { ...defaultPrivacy, spectators: true });
  await command(b, "social:settings", { ...defaultPrivacy, spectators: true });
  await command(a, "social:challenge", {
    target: b.user.id,
    game: "grid",
    rules: { length: "quick", spectators: true },
  });
  const watchInvite = (await state(b)).challenges[0];
  await command(b, "social:challenge:respond", {
    challengeId: watchInvite.id,
    accept: true,
  });
  await until(() => a.state?.game === "grid" && a.state.phase === "active");
  const watched = await command(c, "social:watch", { target: a.user.id });
  assert.equal(watched.state.id, a.state!.id);
  await until(() => !!c.watch?.competition);
  await rejected(d, "social:watch", { target: a.user.id });
  c.socket.emit("action", { challengeId: a.state!.challenge!.id, tile: 43 });
  await pause(150);
  assert.equal(a.state!.competition!.tiles[43], null);
  await command(a, "social:settings", { ...defaultPrivacy, spectators: false });
  await rejected(c, "social:watch", { target: a.user.id });
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  console.log(
    "PASS opt-in spectators, shared live state, non-friend denial, read-only actions and immediate privacy revocation.",
  );
  await command(a, "social:challenge", { target: c.user.id, game: "any" });
  const cancelled = (await state(c)).challenges[0];
  c.socket.disconnect();
  await until(
    async () =>
      (await state(a)).challenges.find((x) => x.id === cancelled.id)?.status ===
      "cancelled",
  );
  await connect(c);
  await command(b, "social:block", { target: a.user.id, blocked: true });
  assert.equal(
    (await state(a)).friends.some((f) => f.id === b.user.id),
    false,
  );
  await rejected(a, "social:request", { target: b.user.id });
  await rejected(a, "social:messages", { target: b.user.id });
  await rejected(a, "social:challenge", { target: b.user.id, game: "clash" });
  assert.equal(
    (await command(a, "social:search", { query: b.user.username })).players
      .length,
    0,
  );
  const oldInvite = await command(a, "invite:create", { game: "reaction" });
  await rejected(b, "invite:join", { code: oldInvite.code });
  await command(a, "queue:leave");
  await command(b, "social:block", { target: a.user.id, blocked: false });
  await friend(a, b);
  await command(d, "social:settings", { ...defaultPrivacy, requests: false });
  await rejected(a, "social:request", { target: d.user.id });
  await command(b, "social:settings", { ...defaultPrivacy, challenges: false });
  await rejected(a, "social:challenge", { target: b.user.id, game: "dodge" });
  await command(b, "social:settings", defaultPrivacy);
  console.log(
    "PASS disconnect cancellation, blocking removes friendship and prevents links/requests/messages/challenges/search; settings persist.",
  );
  for (let i = 0; i < 30; i++) {
    await command(c, "social:send", {
      target: a.user.id,
      body: `Rate-limit QA ${i}`,
      messageId: randomUUID(),
    });
    await pause(50);
  }
  await rejected(c, "social:send", {
    target: a.user.id,
    body: "Over the limit",
    messageId: randomUUID(),
  });
  console.log(
    "PASS persistent message spam limit rejects the 31st message in a minute.",
  );
  await pause(10000);
  await command(a, "social:challenge", {
    target: b.user.id,
    game: "reaction",
    rules: { length: "extended", spectators: false },
  });
  const expires = (await state(b)).challenges[0];
  await stop();
  const db = new Database("", directory);
  const saved = (
    await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM private_messages",
    )
  ).rows[0].count;
  assert.equal(saved, 32);
  await db.query(
    "UPDATE social_challenges SET status='pending',expires_at=now()-interval '1 second' WHERE id=$1",
    [expires.id],
  );
  await db.close();
  await start();
  await Promise.all(clients.map(connect));
  assert.equal(
    (await state(b)).challenges.find((x) => x.id === expires.id)?.status,
    "expired",
  );
  await rejected(b, "social:challenge:respond", {
    challengeId: expires.id,
    accept: true,
  });
  assert.equal((await state(a)).friends.length, 2);
  assert.equal(
    (await command(b, "social:messages", { target: a.user.id })).messages
      .length,
    2,
  );
  assert.equal((await state(d)).settings.requests, false);
  assert.equal(
    (await command(a, "social:profile", { target: b.user.id })).rivalry.played,
    3,
  );
  console.log(
    "PASS database restart preserves friends, messages, settings, rivalry and challenge history; pending/expired invites cannot launch a match.",
  );
  await pause(10000);
  await command(a, "social:challenge", { target: b.user.id, game: "any" });
  const liveExpiry = (await state(b)).challenges[0];
  await until(async () => {
    await pause(1000);
    return (
      (await state(b)).challenges.find((x) => x.id === liveExpiry.id)
        ?.status === "expired"
    );
  }, 70000);
  await rejected(b, "social:challenge:respond", {
    challengeId: liveExpiry.id,
    accept: true,
  });
  assert.equal(a.state?.phase, "finished");
  console.log(
    "PASS live 60-second expiry updates both clients and refuses late acceptance.",
  );
  await command(a, "social:remove", { target: b.user.id });
  assert.equal((await state(b)).friends.length, 0);
  await rejected(a, "social:send", {
    target: b.user.id,
    body: "No longer friends",
    messageId: randomUUID(),
  });
  assert(
    !output.includes("Unhandled") && !output.includes("Settlement retry"),
    output,
  );
} finally {
  await stop();
}
