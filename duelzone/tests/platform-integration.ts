import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Database } from "../server/db";
import { defaultPrivacy, type SocialState } from "../lib/social";
import { games, type MatchState, type Player } from "../lib/shared";

const origin = "http://localhost:3106",
  directory = resolve("test-results", "platform-" + randomUUID());
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
        PORT: "3106",
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
    c = await create(3);
  await friend(a, b);
  let alerts = (await command(b, "platform:state")).platform;
  assert.equal(alerts.unread, 1);
  assert.equal(alerts.notifications[0].kind, "request");
  await command(c, "notifications:read", { ids: [alerts.notifications[0].id] });
  assert.equal((await command(b, "platform:state")).platform.unread, 1);
  await command(b, "notifications:read", {});
  assert.equal((await command(b, "platform:state")).platform.unread, 0);
  await command(a, "social:activity", { away: true });
  await until(() =>
    b.presence.some((p) => p.id === a.user.id && p.presence === "away"),
  );
  await command(a, "social:activity", { away: false });
  await command(a, "social:challenge", { target: b.user.id, game: "core" });
  const invite = (await state(b)).challenges[0];
  await command(b, "social:challenge:respond", {
    challengeId: invite.id,
    accept: true,
  });
  await until(() =>
    b.presence.some(
      (p) =>
        p.id === a.user.id && p.presence === "in-match" && p.game === "core",
    ),
  );
  await command(a, "match:leave");
  await stop();
  await start();
  await connect(b);
  alerts = (await command(b, "platform:state")).platform;
  assert(
    alerts.notifications.some((n: any) => n.kind === "request" && n.read_at),
  );
  assert(
    alerts.notifications.some((n: any) => n.kind === "challenge" && !n.read_at),
  );
  console.log(
    "PASS phase 1: durable notifications, owner-only read state, away/game presence, direct challenge and restart persistence.",
  );
  await connect(a);
  await connect(c);
  const prefs = {
    favorites: ["core"],
    excluded: games.filter((g) => g !== "core"),
  };
  await command(a, "preferences:save", prefs);
  await command(b, "preferences:save", prefs);
  await rejected(a, "preferences:save", {
    favorites: [],
    excluded: [...games],
  });
  await command(a, "queue:join", { game: "any", mode: "casual" });
  await command(b, "queue:join", { game: "any", mode: "casual" });
  await until(
    () =>
      a.state?.game === "core" &&
      a.state.id === b.state?.id &&
      a.state?.phase !== "finished",
  );
  await command(a, "match:leave");
  await stop();
  await start();
  await connect(a);
  await connect(b);
  await connect(c);
  assert.deepEqual(
    (await command(a, "platform:state")).platform.preferences,
    prefs,
  );
  console.log(
    "PASS phase 2: persistent favorites/exclusions, random compatible Quick Match, all-mode exclusion rejected.",
  );
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const media = await request(
    "/profile/media",
    { avatar: pixel, banner: pixel, cosmetic: "graphite" },
    a.cookie,
  );
  const image = await fetch(origin + media.data.player.avatar);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert(image.ok);
  await assert.rejects(
    request(
      "/profile/media",
      { avatar: "data:image/svg+xml;base64,PHN2Zz4=", cosmetic: "graphite" },
      a.cookie,
    ),
  );
  await assert.rejects(
    request("/profile/media", { cosmetic: "laurel" }, a.cookie),
  );
  const updated = (await request("/profile/" + a.user.id)).data;
  assert.deepEqual(updated.favorites, ["core"]);
  assert(updated.player.avatar);
  assert(updated.player.banner);
  assert(updated.rivals.some((r: any) => r.id === b.user.id));
  assert.equal(updated.progression.weekly.length, 3);
  console.log(
    "PASS phase 3: custom avatar/banner delivery, unsafe image and unearned cosmetic rejected, favorites, real rivalry and weekly progress.",
  );
  const platform = async (c: Client) =>
    (await command(c, "platform:state")).platform;
  await friend(a, c);
  await command(a, "party:create");
  await command(a, "party:invite", { target: b.user.id });
  await rejected(a, "party:invite", { target: b.user.id });
  const partyInvite = (await platform(b)).invitations[0];
  await rejected(c, "party:respond", {
    inviteId: partyInvite.id,
    accept: true,
  });
  await command(b, "party:respond", { inviteId: partyInvite.id, accept: true });
  await rejected(a, "party:invite", { target: c.user.id });
  await rejected(b, "party:configure", {
    game: "core",
    rules: { length: "quick", spectators: false },
  });
  await command(a, "party:ready", { ready: true });
  await command(b, "party:ready", { ready: true });
  await command(a, "party:configure", {
    game: "core",
    rules: { length: "quick", spectators: false },
  });
  assert((await platform(a)).party.members.every((m: any) => !m.ready));
  await rejected(a, "party:launch", {});
  await command(a, "party:ready", { ready: true });
  await command(b, "party:ready", { ready: true });
  await command(a, "party:launch");
  await until(() => a.state?.phase === "active" && a.state.id === b.state?.id);
  assert.equal(a.state!.rules!.length, "quick");
  await command(a, "match:leave");
  await command(b, "party:ready", { ready: true });
  b.socket.disconnect();
  await pause(200);
  await connect(b);
  assert.equal(
    (await platform(a)).party.members.find((m: any) => m.id === b.user.id)
      .ready,
    false,
  );
  const t = (
    await request(
      "/tournaments",
      { name: "Platform invitation test", game: "reaction" },
      a.cookie,
    )
  ).data;
  await command(a, "tournament:invite", {
    target: b.user.id,
    tournamentId: t.id,
  });
  await rejected(a, "tournament:invite", {
    target: b.user.id,
    tournamentId: t.id,
  });
  const ti = (await platform(b)).tournamentInvitations[0];
  await rejected(c, "tournament:respond", { inviteId: ti.id, accept: true });
  await command(b, "tournament:respond", { inviteId: ti.id, accept: true });
  assert.equal(
    (await request("/tournaments")).data.tournaments.find(
      (x: any) => x.id === t.id,
    ).entrants.length,
    2,
  );
  const mid = randomUUID();
  await command(b, "social:send", {
    target: a.user.id,
    messageId: mid,
    body: "Owned reporting test message.",
  });
  await rejected(c, "social:report", {
    target: b.user.id,
    messageId: mid,
    reason: "spam",
    details: "This is inaccessible to this account.",
  });
  const report = await command(a, "social:report", {
    target: b.user.id,
    messageId: mid,
    reason: "spam",
    details: "Isolated test report, not an actual allegation.",
  });
  assert(report.reportId);
  await rejected(a, "social:report", {
    target: b.user.id,
    messageId: mid,
    reason: "spam",
    details: "Duplicate test report.",
  });
  await stop();
  await start();
  await connect(a);
  await connect(b);
  assert.equal((await platform(a)).party.members.length, 2);
  assert((await platform(a)).party.members.every((m: any) => !m.ready));
  await command(a, "social:block", { target: b.user.id, blocked: true });
  assert.equal((await platform(a)).party, null);
  assert.equal((await platform(b)).party, null);
  console.log(
    "PASS phase 4: private party ready/configure/launch, host authorization, full/duplicate/forged invites, reconnect, tournament registration, reporting access and block cleanup.",
  );
} finally {
  await stop();
}
