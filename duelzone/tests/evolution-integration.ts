import { FrontierBot } from "../lib/frontier-bot";
import { dailyTarget } from "../lib/daily";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { io, type Socket } from "socket.io-client";
import { Database } from "../server/db";
import { defaultPrivacy, type SocialState } from "../lib/social";
import { games, type MatchState, type Player } from "../lib/shared";

const origin = "http://localhost:3107",
  directory = resolve("test-results", "evolution-" + randomUUID());
let server: ChildProcess,
  output = "";
const clients: {
  user: Player;
  cookie: string;
  socket: Socket;
  state?: MatchState;
  daily?: any;
  draft?: any;
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
        PORT: "3107",
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
  socket.on("daily:state", (s) => (c.daily = s));
  socket.on("draft", (s) => (c.draft = s));
  socket.on("match", (s) => (c.state = s));
  socket.on("frame", (f) => {
    if (c.state && c.state.id === f.id)
      c.state = {
        ...c.state,
        ...f,
        frontier:
          f.frontier && c.state.frontier
            ? { ...c.state.frontier, ...f.frontier }
            : c.state.frontier,
      };
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
  for (let i = 0; i < 9; i++) await create(i);
  const [a, b, c] = clients;
  const platform = async (c: Client) =>
    (await command(c, "platform:state")).platform;
  await command(a, "daily:start");
  await command(b, "daily:start");
  assert.deepEqual(a.daily.config, b.daily.config);
  await rejected(a, "queue:join", { game: "any", mode: "casual" });
  await rejected(a, "daily:start", {});
  c.socket.emit("daily:shot", { id: a.daily.id, index: 0, x: 500, y: 300 });
  const at = a.daily.startedAt;
  for (let i = 0; i < 8; i++) {
    await pause(Math.max(1, at + i * 1000 + 350 - Date.now()));
    for (const p of [a, b]) {
      const elapsed = Date.now() - p.daily.startedAt,
        target = dailyTarget(p.daily.config, i, elapsed);
      p.socket.emit("daily:shot", {
        id: p.daily.id,
        index: i,
        x: target.x,
        y: target.y,
      });
      p.socket.emit("daily:shot", {
        id: p.daily.id,
        index: i,
        x: target.x,
        y: target.y,
      });
    }
  }
  await until(() => a.daily?.shots === 8 && b.daily?.shots === 8);
  assert(a.daily.score > 750 && a.daily.score <= 800);
  await until(
    () => a.daily?.status === "finished" && b.daily?.status === "finished",
    35000,
  );
  const daily = (await request("/daily", undefined, a.cookie)).data;
  assert.equal(daily.board.length, 2);
  assert.equal(daily.personal.score, a.daily.score);
  assert.equal(daily.history.length, 1);
  await command(a, "daily:start");
  await command(a, "daily:cancel");
  assert.equal(
    (await request("/daily", undefined, a.cookie)).data.personal.score,
    daily.personal.score,
  );
  console.log(
    "PASS Daily Duel: identical UTC circuit, actual server-scored hits, duplicate/forged inputs rejected, queue exclusion, completed leaderboard/history, cancellation preserves best.",
  );
  await command(a, "queue:join", { game: "showdown", mode: "ranked" });
  await command(b, "queue:join", { game: "showdown", mode: "ranked" });
  await until(() => a.draft && b.draft && a.draft.id === b.draft.id);
  const draft = a.draft.id;
  await rejected(c, "draft:choose", {
    id: draft,
    ban: "core",
    preferred: "ball",
    ready: true,
  });
  await command(a, "draft:choose", {
    id: draft,
    ban: "shadow",
    preferred: "core",
    ready: true,
  });
  await command(b, "draft:choose", {
    id: draft,
    ban: "grapple",
    preferred: "core",
    ready: true,
  });
  await until(
    () => a.draft?.phase === "confirm" && b.draft?.phase === "confirm",
  );
  assert.deepEqual(a.draft.selection, b.draft.selection);
  assert.equal(a.draft.selection[0], "core");
  for (const p of [a, b])
    await command(p, "draft:choose", {
      id: draft,
      ban: null,
      preferred: null,
      ready: true,
    });
  await until(() => a.state?.phase === "active" && b.state?.id === a.state.id);
  assert.equal(a.state!.rounds, 3);
  assert.equal(a.state!.frontier!.game, "core");
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  assert.equal((await request("/profile/" + a.user.id)).data.mastery.length, 0);
  console.log(
    "PASS ranked Showdown: two synchronized draft clients, unauthorized selection denied, both bans respected, preferred opening game, three-round engine, forfeit earns no mastery.",
  );
  for (const p of clients.slice(1)) await friend(a, p);
  await command(a, "party:create");
  for (const p of clients.slice(1, 8)) {
    await command(a, "party:invite", { target: p.user.id });
    const invite = (await platform(p)).invitations[0];
    await command(p, "party:respond", { inviteId: invite.id, accept: true });
  }
  const room = (await platform(a)).party;
  assert.equal(room.members.length, 8);
  assert.equal(room.members.filter((m: any) => m.role === "player").length, 2);
  await rejected(a, "party:invite", { target: clients[8].user.id });
  await rejected(c, "party:seat", { target: a.user.id, role: "spectator" });
  await rejected(a, "party:seat", { target: c.user.id, role: "player" });
  await command(c, "party:message", {
    id: randomUUID(),
    body: "A real lobby message",
  });
  assert(
    (await platform(b)).party.messages.some(
      (m: any) => m.body === "A real lobby message",
    ),
  );
  await rejected(clients[8], "party:message", {
    id: randomUUID(),
    body: "not allowed",
  });
  for (const p of [a, b])
    await command(p, "social:settings", {
      ...defaultPrivacy,
      spectators: true,
    });
  await command(a, "party:configure", {
    game: "core",
    rules: { length: "quick", spectators: true },
  });
  for (const p of [a, b]) await command(p, "party:ready", { ready: true });
  await command(a, "party:launch");
  await until(() => a.state?.phase === "active" && b.state?.id === a.state.id);
  assert.equal(a.state!.players.length, 2);
  assert.equal((await platform(c)).party.watching, true);
  const watched = await command(c, "social:watch", { target: b.user.id });
  assert.equal(watched.state.id, a.state!.id);
  c.socket.emit("action", {
    challengeId: a.state!.challenge!.id,
    dx: 1,
    dy: 1,
    seq: 1,
  });
  await rejected(a, "party:seat", { target: c.user.id, role: "player" });
  await command(a, "match:leave");
  await until(() => a.state?.phase === "finished");
  await command(a, "party:remove", { target: c.user.id });
  assert.equal((await platform(c)).party, null);
  await command(a, "party:leave");
  console.log(
    "PASS eight-person lobby: two active seats, six spectators, host controls, capacity/ownership checks, private chat, authorized live viewing and removal.",
  );
  await command(a, "social:challenge", {
    target: b.user.id,
    game: "grapple",
    rules: { length: "quick", spectators: false },
  });
  const challenge = (await state(b)).challenges.find(
    (c) => c.from_id === a.user.id && c.status === "pending",
  )!;
  await command(b, "social:challenge:respond", {
    challengeId: challenge.id,
    accept: true,
  });
  await until(() => a.state?.phase === "active" && a.state.game === "grapple");
  const recordedId = a.state!.id,
    drivers = [
      new FrontierBot(a.user.id, "hard"),
      new FrontierBot(b.user.id, "hard"),
    ];
  const steering = setInterval(() => {
    for (const [i, p] of [a, b].entries()) {
      const s = p.state;
      if (s?.phase === "active" && s.frontier) {
        const input = drivers[i].think(s.frontier, Date.now());
        if (input)
          p.socket.emit("action", { challengeId: s.challenge!.id, ...input });
      }
    }
  }, 60);
  await until(
    () => a.state?.id === recordedId && a.state.phase === "finished",
    75000,
  );
  clearInterval(steering);
  await until(async () => {
    const r = await fetch(origin + "/api/replays/" + recordedId, {
      headers: { Cookie: a.cookie },
    });
    return r.ok;
  });
  const replay = (await request("/replays/" + recordedId, undefined, a.cookie))
    .data.replay;
  assert.equal(replay.version, 1);
  assert(replay.frames.length > 10);
  assert(replay.duration > 2000);
  await assert.rejects(request("/replays/" + recordedId, undefined, c.cookie));
  await assert.rejects(
    request("/replays/" + recordedId + "/share", {}, a.cookie),
  );
  for (const p of [a, b])
    await command(p, "social:settings", {
      ...defaultPrivacy,
      replays: true,
      activity: true,
    });
  const shared = (
    await request("/replays/" + recordedId + "/share", {}, a.cookie)
  ).data.url;
  const token = new URL(shared).searchParams.get("share")!;
  assert.equal(
    (await request(`/replays/${recordedId}?share=${token}`)).data.replay
      .matchId,
    recordedId,
  );
  await command(b, "social:settings", { ...defaultPrivacy, replays: false });
  await assert.rejects(request(`/replays/${recordedId}?share=${token}`));
  const ghosts = (await request("/ghosts", undefined, a.cookie)).data.ghosts;
  assert(
    ghosts.some(
      (g: any) => g.match_id === recordedId && g.user_id === a.user.id,
    ),
  );
  await command(a, "ghost:start", {
    replayId: recordedId,
    sourceId: a.user.id,
  });
  await until(() => a.state?.mode === "ghost" && a.state.phase === "active");
  assert(a.state!.players[1].ghost);
  assert.equal(a.state!.frontier!.map, replay.frames[0].view.map);
  await until(
    () => a.state?.mode === "ghost" && a.state.phase === "finished",
    100000,
  );
  assert.equal(a.state!.reason, "Score");
  assert.equal(
    a.state!.scores[a.state!.players[1].id],
    replay.frames.at(-1).view.points[a.user.id],
  );
  await until(async () =>
    (await request("/training", undefined, a.cookie)).data.recent.some(
      (r: any) => r.difficulty === "ghost",
    ),
  );
  const ghostTraining = (await request("/training", undefined, a.cookie)).data;
  assert(ghostTraining.recent.some((r: any) => r.difficulty === "ghost"));
  await command(a, "match:leave");
  const report = (
    await request(
      "/feedback",
      {
        kind: "rating",
        game: "grapple",
        matchId: recordedId,
        rating: 4,
        body: "Good movement; testing real feedback.",
      },
      a.cookie,
    )
  ).data;
  assert(report.id);
  await assert.rejects(
    request(
      "/feedback",
      {
        kind: "rating",
        game: "grapple",
        matchId: recordedId,
        rating: 4,
        body: "Forged match ownership.",
      },
      c.cookie,
    ),
  );
  const feed = (await request("/activity", undefined, b.cookie)).data.events;
  assert(feed.some((e: any) => e.user_id === a.user.id));
  await command(a, "social:settings", { ...defaultPrivacy, activity: false });
  assert(
    !(await request("/activity", undefined, b.cookie)).data.events.some(
      (e: any) => e.user_id === a.user.id,
    ),
  );
  console.log(
    "PASS authoritative Grapple recording, compressed replay, private access, consent-based sharing/revocation, actual recorded ghost on the same map, activity privacy and feedback ownership.",
  );
  const tournament = (
    await request(
      "/tournaments",
      { name: "Private eight", game: "precision", capacity: 8, private: true },
      a.cookie,
    )
  ).data;
  assert(
    !(await request("/tournaments")).data.tournaments.some(
      (t: any) => t.id === tournament.id,
    ),
  );
  await assert.rejects(
    request(`/tournaments/${tournament.id}/join`, {}, clients[8].cookie),
  );
  for (const p of clients.slice(1, 8)) {
    await command(a, "tournament:invite", {
      target: p.user.id,
      tournamentId: tournament.id,
    });
    const invite = (await platform(p)).tournamentInvitations[0];
    await command(p, "tournament:respond", {
      inviteId: invite.id,
      accept: true,
    });
  }
  await rejected(a, "tournament:start", { id: tournament.id });
  for (const p of clients.slice(0, 8))
    await command(p, "tournament:ready", { id: tournament.id, ready: true });
  await command(a, "tournament:start", { id: tournament.id });
  let finished: any;
  const forfeited = new Set<string>();
  await until(async () => {
    const t = (
      await request("/tournaments", undefined, a.cookie)
    ).data.tournaments.find((t: any) => t.id === tournament.id);
    if (t.status === "finished") {
      finished = t;
      return true;
    }
    for (const f of t.fixtures)
      if (f.match_id && !f.winner && !forfeited.has(f.match_id)) {
        const loser = clients.find((p) => p.user.id === f.player_b)!;
        forfeited.add(f.match_id);
        await command(loser, "match:leave");
      }
    return false;
  }, 15000);
  assert.equal(finished.fixtures.length, 7);
  assert.equal(finished.winner, a.user.username);
  console.log(
    "PASS private eight-player tournament: no public listing, invitation-only entry, mandatory readiness, four quarterfinals, two semifinals, final and persisted winner.",
  );
  await command(a, "ai:start", { game: "precision", difficulty: "expert" });
  await until(
    () => a.state?.mode === "ai" && a.state.phase === "finished",
    60000,
  );
  const training = (await request("/training", undefined, a.cookie)).data;
  assert.equal(training.recent.length, 2);
  assert(training.recent[0].opponent_score > 0);
  assert.equal(training.records.length, 2);
  assert(
    (await request("/profile/" + a.user.id)).data.mastery.some(
      (m: any) => m.game === "grapple",
    ),
  );
  await stop();
  await start();
  assert.equal(
    (await request("/daily", undefined, a.cookie)).data.personal.score,
    daily.personal.score,
  );
  assert.equal(
    (await request("/training", undefined, a.cookie)).data.recent.length,
    2,
  );
  assert.equal(
    (await request("/me", undefined, a.cookie)).data.player.id,
    a.user.id,
  );
  console.log(
    "PASS classic AI plays legal timed actions; training saved separately, accounts/session/daily records survive restart.",
  );
} finally {
  await stop();
}
