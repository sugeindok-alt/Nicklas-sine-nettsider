export const frontierGames = [
  "knockout",
  "ball",
  "grapple",
  "shadow",
  "core",
  "showdown",
] as const;
export type FrontierGame = (typeof frontierGames)[number];
export type Sport = Exclude<FrontierGame, "showdown">;
export const isFrontier = (game: string): game is FrontierGame =>
  (frontierGames as readonly string[]).includes(game);
export const FRONTIER_INFO = {
  knockout: {
    name: "Knockout Arena",
    short: "Knockout",
    tag: "OWN THE EDGE",
    description:
      "Fight on a shrinking platform. Charge a directional shove, dash into openings and block incoming pushes. Ring-outs score one point. First to three, or most ring-outs after 90 seconds, wins.",
    rounds: 1,
    color: "#c8f36a",
    keys: "WASD · SPACE DASH · HOLD J SHOVE · K BLOCK",
  },
  ball: {
    name: "Momentum Ball",
    short: "Momentum",
    tag: "TURN SPEED INTO GOALS",
    description:
      "Drive the ball into the opposite goal. Build momentum, hold and release your shot, dash past your rival and brake to defend. First to five goals or the lead at 90 seconds wins.",
    rounds: 1,
    color: "#a5bce9",
    keys: "WASD · SPACE DASH · HOLD J SHOOT · K BRAKE",
  },
  grapple: {
    name: "Grapple Rush",
    short: "Grapple",
    tag: "FIND YOUR FLOW",
    description:
      "Race across an industrial suspension course. Jump between platforms, hold a grapple to swing around overhead anchors and release at the right moment. Checkpoints save your progress. Reach the finish first.",
    rounds: 1,
    color: "#e8b39a",
    keys: "A/D MOVE · W JUMP · HOLD J GRAPPLE · SPACE BOOST",
  },
  shadow: {
    name: "Shadow Hunt",
    short: "Shadow",
    tag: "READ WHAT ISN’T THERE",
    description:
      "Trade hunter and runner roles in two timed legs. The runner collects three data caches and escapes. The hunter uses line of sight and pulse scans to find and tag them. Crouch to stay quiet. Both legs contribute to the final score.",
    rounds: 2,
    color: "#c2b4df",
    keys: "WASD · SPACE DASH · J SCAN/TAG · HOLD K SNEAK",
  },
  core: {
    name: "Core Control",
    short: "Core",
    tag: "HOLD YOUR GROUND",
    description:
      "Capture the rotating control zone. Time inside an uncontested zone earns points. Charge pulse attacks to displace your rival, block their attacks and dash between cover. The zone moves every 25 seconds.",
    rounds: 1,
    color: "#bdcbd0",
    keys: "WASD · SPACE DASH · HOLD J PULSE · K BLOCK",
  },
  showdown: {
    name: "DuelZone Showdown",
    short: "Showdown",
    tag: "ONE RIVAL. FIVE DISCIPLINES.",
    description:
      "A best-of-five series across Knockout, Momentum, Grapple, Shadow and Core, drawn in a new random order. Win three rounds to take the series. Tied rounds share a point; after five rounds, the higher total wins.",
    rounds: 5,
    color: "#e0d5b4",
    keys: "BEST OF FIVE · ADAPT EACH ROUND",
  },
} as const;
export type Vector = { x: number; y: number };
export type Body = Vector & { vx: number; vy: number };
export type Wall = Vector & { w: number; h: number };
export type Control = {
  dx: number;
  dy: number;
  aimX: number;
  aimY: number;
  primary: boolean;
  secondary: boolean;
  ability: boolean;
  jump: boolean;
  seq: number;
};
export const neutral = (): Control => ({
  dx: 0,
  dy: 0,
  aimX: 1,
  aimY: 0,
  primary: false,
  secondary: false,
  ability: false,
  jump: false,
  seq: 0,
});
export type Fighter = Body & {
  id: string;
  hp: number;
  energy: number;
  facing: Vector;
  input: Control;
  ack: number;
  lastInput: number;
  dashUntil: number;
  dashReady: number;
  attackReady: number;
  charge: number;
  invulnerable: number;
  grounded: boolean;
  hook: Vector | null;
  checkpoint: number;
  teleports: number;
  revealed: number;
  hidden?: boolean;
  stats: {
    hits: number;
    dashes: number;
    goals: number;
    falls: number;
    captures: number;
  };
};
export type RoundRecord = {
  game: Sport;
  scores: Record<string, number>;
  winner: string | null;
  stats: Record<string, Fighter["stats"]>;
};
export type FrontierView = {
  game: Sport;
  series: boolean;
  round: number;
  now: number;
  startedAt: number;
  deadline: number;
  transitionUntil: number;
  ended: boolean;
  players: Record<string, Fighter>;
  points: Record<string, number>;
  seriesScore: Record<string, number>;
  history: RoundRecord[];
  walls: Wall[];
  anchors: Vector[];
  checkpoints: Vector[];
  width: number;
  height: number;
  map: string;
  ring: number;
  ball: Body;
  objective: Vector;
  relics: (Vector & { taken: boolean })[];
  hunter: string;
  leg: number;
  legEnds: number;
  event: {
    id: number;
    text: string;
    x: number;
    y: number;
    kind: "hit" | "goal" | "stage";
  };
  resetUntil: number;
};
export const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
export const distance = (a: Vector, b: Vector) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x: number, y: number) => {
  const d = Math.hypot(x, y) || 1;
  return { x: x / d, y: y / d };
};
export function visible(a: Vector, b: Vector, walls: Wall[]) {
  for (const w of walls) {
    let t0 = 0,
      t1 = 1;
    for (const [p, d, min, max] of [
      [a.x, b.x - a.x, w.x, w.x + w.w],
      [a.y, b.y - a.y, w.y, w.y + w.h],
    ]) {
      if (Math.abs(d) < 0.0001) {
        if (p < min || p > max) {
          t0 = 2;
          break;
        }
      } else {
        const x = (min - p) / d,
          y = (max - p) / d;
        t0 = Math.max(t0, Math.min(x, y));
        t1 = Math.min(t1, Math.max(x, y));
      }
    }
    if (t0 <= t1) return false;
  }
  return true;
}
function collide(p: Body, w: Wall, r: number, bounce = 0) {
  const x = clamp(p.x, w.x, w.x + w.w),
    y = clamp(p.y, w.y, w.y + w.h);
  let dx = p.x - x,
    dy = p.y - y,
    d = Math.hypot(dx, dy);
  if (d >= r) return false;
  if (!d) {
    const edges = [
      Math.abs(p.x - w.x),
      Math.abs(p.x - w.x - w.w),
      Math.abs(p.y - w.y),
      Math.abs(p.y - w.y - w.h),
    ];
    const edge = edges.indexOf(Math.min(...edges));
    dx = edge === 0 ? -1 : edge === 1 ? 1 : 0;
    dy = edge === 2 ? -1 : edge === 3 ? 1 : 0;
    p.x += dx * (edges[edge] + r);
    p.y += dy * (edges[edge] + r);
    d = 1;
  } else {
    p.x += (dx / d) * (r - d);
    p.y += (dy / d) * (r - d);
  }
  const nx = dx / d,
    ny = dy / d,
    speed = p.vx * nx + p.vy * ny;
  if (speed < 0) {
    p.vx -= (1 + bounce) * speed * nx;
    p.vy -= (1 + bounce) * speed * ny;
  }
  return ny < -0.5;
}
export function moveFighter(
  p: Fighter,
  v: FrontierView,
  input: Control,
  dt: number,
  now: number,
) {
  const side = v.game === "grapple";
  const magnitude = Math.max(1, Math.hypot(input.dx, input.dy));
  const slow = input.secondary ? 0.42 : 1;
  if (side) {
    p.vx += input.dx * 1100 * dt;
    p.vx *= Math.exp(-(p.grounded ? 3 : 0.65) * dt);
    p.vy += 1150 * dt;
    p.vx = clamp(p.vx, -530, 530);
    p.vy = clamp(p.vy, -800, 850);
    if (p.hook && input.primary) {
      const dx = p.hook.x - p.x,
        dy = p.hook.y - p.y,
        d = Math.hypot(dx, dy) || 1;
      const pull = Math.max(0, d - 105) * 7 + 350;
      p.vx += (dx / d) * pull * dt;
      p.vy += (dy / d) * pull * dt;
    }
  } else {
    const acceleration = now < p.dashUntil ? 300 : 2100 * slow;
    p.vx += (input.dx / magnitude) * acceleration * dt;
    p.vy += (input.dy / magnitude) * acceleration * dt;
    const drag = now < p.dashUntil ? 1.4 : input.secondary ? 12 : 7;
    p.vx *= Math.exp(-drag * dt);
    p.vy *= Math.exp(-drag * dt);
  }
  p.grounded = false;
  const parts = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 9));
  for (let i = 0; i < parts; i++) {
    p.x += (p.vx * dt) / parts;
    p.y += (p.vy * dt) / parts;
    for (const wall of v.walls) if (collide(p, wall, 17)) p.grounded = true;
    if (v.game !== "knockout") {
      if (p.x < 18 || p.x > v.width - 18) {
        p.x = clamp(p.x, 18, v.width - 18);
        p.vx = 0;
      }
      if (!side && (p.y < 18 || p.y > v.height - 18)) {
        p.y = clamp(p.y, 18, v.height - 18);
        p.vy = 0;
      }
    }
  }
}
export class Frontier {
  view: FrontierView;
  private previous: number;
  private serial = 0;
  private schedule: Sport[];
  private scoresBase: Record<string, number>;
  private legStart = 0;
  private legDuration = 45000;
  constructor(
    readonly game: FrontierGame,
    readonly ids: string[],
    now: number,
    private random = Math.random,
    private scale = 1,
  ) {
    this.schedule = ["knockout", "ball", "grapple", "shadow", "core"];
    if (game === "showdown")
      for (let i = 4; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [this.schedule[i], this.schedule[j]] = [
          this.schedule[j],
          this.schedule[i],
        ];
      }
    else this.schedule = [game];
    const zero = () => Object.fromEntries(ids.map((id) => [id, 0]));
    this.scoresBase = zero();
    this.previous = now;
    this.view = {
      game: this.schedule[0],
      series: game === "showdown",
      round: 0,
      now,
      startedAt: now,
      deadline: now,
      transitionUntil: 0,
      ended: false,
      players: {},
      points: zero(),
      seriesScore: zero(),
      history: [],
      walls: [],
      anchors: [],
      checkpoints: [],
      width: 1000,
      height: 600,
      map: "",
      ring: 230,
      ball: { x: 500, y: 300, vx: 0, vy: 0 },
      objective: { x: 500, y: 300 },
      relics: [],
      hunter: ids[0],
      leg: 1,
      legEnds: now,
      event: { id: 0, text: "", x: 500, y: 300, kind: "stage" },
      resetUntil: now,
    };
    this.begin(now);
  }
  private event(
    text: string,
    at: Vector,
    kind: FrontierView["event"]["kind"] = "hit",
  ) {
    this.view.event = { id: ++this.serial, text, ...at, kind };
  }
  private spawn(id: string, i: number, now: number): Fighter {
    return {
      id,
      x: 250 + i * 500,
      y: 300,
      vx: 0,
      vy: 0,
      hp: 100,
      energy: 100,
      facing: { x: i ? -1 : 1, y: 0 },
      input: neutral(),
      ack: 0,
      lastInput: now,
      dashUntil: 0,
      dashReady: now,
      attackReady: now,
      charge: 0,
      invulnerable: now + 1200,
      grounded: false,
      hook: null,
      checkpoint: 0,
      teleports: 0,
      revealed: now + 1500,
      stats: { hits: 0, dashes: 0, goals: 0, falls: 0, captures: 0 },
    };
  }
  private begin(now: number) {
    const v = this.view;
    v.round++;
    v.game = this.schedule[v.round - 1];
    v.startedAt = now;
    v.now = now;
    v.deadline = now + (v.series ? 26000 : 90000) * this.scale;
    v.transitionUntil = 0;
    v.resetUntil = now + 1800;
    v.width = v.game === "grapple" ? 14600 : 1000;
    v.height = 600;
    v.players = Object.fromEntries(
      this.ids.map((id, i) => [id, this.spawn(id, i, now)]),
    );
    v.points = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.scoresBase = { ...v.points };
    v.walls = [];
    v.anchors = [];
    v.checkpoints = [];
    v.ring = 230;
    v.objective = { x: 500, y: 300 };
    v.leg = 1;
    v.ball = { x: 500, y: 300, vx: 0, vy: 0 };
    if (v.game === "knockout") {
      v.map = "APERTURE / RING 01";
      for (const [i, p] of Object.values(v.players).entries())
        p.x = 410 + i * 180;
    }
    if (v.game === "ball") v.map = "VECTOR / INDOOR COURT";
    if (v.game === "core") {
      v.map = "NEXUS / CONTROL FLOOR";
      v.walls = [
        { x: 225, y: 155, w: 150, h: 30 },
        { x: 625, y: 415, w: 150, h: 30 },
        { x: 625, y: 155, w: 30, h: 100 },
        { x: 345, y: 345, w: 30, h: 100 },
      ];
    }
    if (v.game === "grapple") {
      const variant = Math.floor(this.random() * 3);
      v.map = [
        "SUSPENSION / EAST GANTRY",
        "SUSPENSION / HIGH LINE",
        "SUSPENSION / LOWER DECK",
      ][variant];
      v.walls = Array.from({ length: 28 }, (_, i) => ({
        x: i * 520,
        y: i === 0 ? 480 : 405 + ((i + variant) % 3) * 35,
        w: 180,
        h: 160,
      }));
      v.anchors = Array.from({ length: 56 }, (_, i) => ({
        x: 210 + i * 260,
        y: 120 + ((i + variant) % 2) * 70,
      }));
      v.checkpoints = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27].map((i) => ({
        x: i * 520 + 70,
        y: v.walls[i].y - 19,
      }));
      Object.values(v.players).forEach((p, i) => {
        p.x = 60;
        p.y = 450 - i * 42;
      });
    }
    if (v.game === "shadow") {
      this.legDuration = (v.deadline - now) / 2;
      v.map = "BLACKSITE / ARCHIVE";
      v.walls = [
        { x: 260, y: 100, w: 55, h: 180 },
        { x: 260, y: 360, w: 55, h: 140 },
        { x: 470, y: 220, w: 65, h: 160 },
        { x: 690, y: 100, w: 50, h: 160 },
        { x: 690, y: 340, w: 50, h: 160 },
      ];
      this.shadowLeg(now);
    }
    this.event(FRONTIER_INFO[v.game].tag, v.objective, "stage");
    this.previous = now;
  }
  private shadowLeg(now: number) {
    const v = this.view;
    v.hunter = this.ids[v.leg - 1];
    this.legStart = now;
    v.legEnds = now + this.legDuration;
    if (v.leg === 2) v.deadline = v.legEnds;
    v.relics = [
      { x: 850, y: 105, taken: false },
      { x: 470, y: 95, taken: false },
      { x: 850, y: 495, taken: false },
    ];
    for (const p of Object.values(v.players)) {
      p.x = p.id === v.hunter ? 120 : 870;
      p.y = 300;
      p.vx = p.vy = 0;
      p.teleports++;
      p.revealed = now + 1200;
      p.invulnerable = now + 1800;
      p.energy = 100;
    }
    v.resetUntil = now + 1800;
  }
  private finishLeg(now: number) {
    if (this.view.leg === 1) {
      this.view.leg = 2;
      this.shadowLeg(now);
      this.event("ROLES REVERSED", this.view.objective, "stage");
    } else this.endRound(now);
  }
  action(id: string, action: Partial<Control>, now: number) {
    const p = this.view.players[id];
    if (
      !p ||
      this.view.ended ||
      this.view.transitionUntil ||
      (action.seq !== undefined && action.seq <= p.ack)
    )
      return;
    const previous = p.input;
    p.input = { ...previous };
    for (const key of Object.keys(neutral()) as (keyof Control)[])
      if (action[key] !== undefined)
        (p.input as unknown as Record<string, unknown>)[key] = action[key];
    p.lastInput = now;
    p.ack = Math.max(p.ack, action.seq || 0);
    if (
      !Object.values(p.input).every(
        (x) => typeof x === "boolean" || Number.isFinite(x),
      )
    ) {
      p.input = neutral();
      return;
    }
    p.input.dx = clamp(p.input.dx, -1, 1);
    p.input.dy = clamp(p.input.dy, -1, 1);
    if (Math.hypot(p.input.aimX, p.input.aimY) > 0.1)
      p.facing = unit(p.input.aimX, p.input.aimY);
    if (now < this.view.resetUntil) return;
    if (
      p.input.ability &&
      !previous.ability &&
      now >= p.dashReady &&
      p.energy >= 25
    ) {
      const dir =
        Math.hypot(p.input.dx, p.input.dy) > 0.1
          ? unit(p.input.dx, p.input.dy)
          : p.facing;
      p.vx += dir.x * 660;
      p.vy +=
        (this.view.game === "grapple" ? Math.min(-0.25, dir.y) : dir.y) * 660;
      p.dashUntil = now + 200;
      p.dashReady = now + 1500;
      p.energy -= 25;
      p.revealed = now + 1600;
      p.stats.dashes++;
    }
    if (this.view.game === "grapple") {
      if (p.input.jump && !previous.jump && p.grounded) {
        p.vy = -540;
        p.grounded = false;
      }
      if (p.input.primary && !previous.primary) {
        const anchor = this.view.anchors
          .filter(
            (a) =>
              distance(p, a) < 470 &&
              a.y < p.y &&
              visible(p, a, this.view.walls),
          )
          .sort((a, b) => {
            const score = (q: Vector) =>
              distance(p, q) - (q.x - p.x) * p.facing.x * 0.7;
            return score(a) - score(b);
          })[0];
        p.hook = anchor ? { ...anchor } : null;
      }
      if (!p.input.primary) p.hook = null;
    } else if (this.view.game === "shadow") {
      if (
        id === this.view.hunter &&
        p.input.primary &&
        !previous.primary &&
        now >= p.attackReady
      ) {
        p.attackReady = now + 3500;
        const rival = this.view.players[this.ids.find((x) => x !== id)!];
        if (distance(p, rival) < 310) rival.revealed = now + 2000;
        this.event("PULSE SCAN", p);
      }
    } else if (previous.primary && !p.input.primary) this.attack(p, now);
  }
  private attack(p: Fighter, now: number) {
    const v = this.view,
      power = 0.45 + Math.min(1, p.charge / 0.7) * 0.55;
    p.charge = 0;
    if (now < p.attackReady || p.energy < 12) return;
    p.attackReady = now + 520;
    p.energy -= 12;
    if (v.game === "ball") {
      if (distance(p, v.ball) < 77) {
        v.ball.vx = p.facing.x * (400 + power * 630) + p.vx * 0.4;
        v.ball.vy = p.facing.y * (400 + power * 630) + p.vy * 0.4;
        p.stats.hits++;
        this.event("STRIKE", v.ball);
      }
      return;
    }
    for (const q of Object.values(v.players)) {
      if (
        p.id === q.id ||
        distance(p, q) > 105 ||
        now < q.invulnerable ||
        !visible(p, q, v.walls)
      )
        continue;
      const d = unit(q.x - p.x, q.y - p.y);
      if (d.x * p.facing.x + d.y * p.facing.y < 0.15) continue;
      const blocked =
        q.input.secondary &&
        q.energy > 5 &&
        q.facing.x * -d.x + q.facing.y * -d.y > -0.1;
      const force = (450 + power * 650) * (blocked ? 0.14 : 1);
      q.vx += d.x * force;
      q.vy += d.y * force;
      q.invulnerable = now + 180;
      p.stats.hits++;
      if (blocked) q.energy = Math.max(0, q.energy - 18);
      else q.hp -= 18 + power * 15;
      this.event(blocked ? "BLOCKED" : power > 0.85 ? "CHARGED HIT" : "HIT", q);
      if (v.game === "core" && q.hp <= 0) {
        this.respawn(q, now);
        this.event("DISPLACED", q);
      }
    }
  }
  private respawn(p: Fighter, now: number) {
    const i = this.ids.indexOf(p.id);
    p.x = 250 + i * 500;
    p.y = 300;
    if (this.view.game === "knockout") p.x = 420 + i * 160;
    if (this.view.game === "grapple")
      Object.assign(p, this.view.checkpoints[p.checkpoint]);
    p.vx = p.vy = 0;
    p.hp = 100;
    p.hook = null;
    p.charge = 0;
    p.teleports++;
    p.invulnerable = now + 1300;
    p.stats.falls++;
  }
  tick(now: number) {
    const v = this.view;
    if (v.ended) return;
    if (v.transitionUntil) {
      v.now = now;
      if (now >= v.transitionUntil) this.begin(now);
      return;
    }
    const elapsed = Math.min(250, Math.max(0, now - this.previous));
    this.previous = now;
    const steps = Math.ceil(elapsed / (1000 / 60));
    for (let i = 0; i < steps; i++) {
      v.now = now - elapsed + (elapsed * (i + 1)) / steps;
      if (v.now >= v.resetUntil) this.step(elapsed / steps / 1000, v.now);
      if (v.ended || v.transitionUntil) break;
    }
    v.now = now;
    if (!v.ended && !v.transitionUntil && now >= v.deadline) this.endRound(now);
  }
  private step(dt: number, now: number) {
    const v = this.view;
    for (const p of Object.values(v.players)) {
      if (now - p.lastInput > 450) {
        p.input = neutral();
        p.hook = null;
        p.charge = 0;
      }
      p.energy = clamp(p.energy + (p.input.secondary ? -13 : 19) * dt, 0, 100);
      if (!p.energy) p.input.secondary = false;
      if (p.input.primary) p.charge = Math.min(0.9, p.charge + dt);
      moveFighter(p, v, p.input, dt, now);
    }
    const [a, b] = this.ids.map((id) => v.players[id]);
    if (v.game !== "grapple" && v.game !== "shadow") {
      const d = distance(a, b);
      if (d < 36) {
        const n = d > 0.01 ? unit(b.x - a.x, b.y - a.y) : { x: 1, y: 0 };
        a.x -= (n.x * (36 - d)) / 2;
        a.y -= (n.y * (36 - d)) / 2;
        b.x += (n.x * (36 - d)) / 2;
        b.y += (n.y * (36 - d)) / 2;
        const impulse =
          Math.max(0, (a.vx - b.vx) * n.x + (a.vy - b.vy) * n.y) * 0.7;
        a.vx -= n.x * impulse;
        a.vy -= n.y * impulse;
        b.vx += n.x * impulse;
        b.vy += n.y * impulse;
      }
    }
    if (v.game === "knockout") {
      v.ring = Math.max(
        90,
        230 - ((now - v.startedAt) / (v.deadline - v.startedAt)) * 140,
      );
      const fallen = [a, b].filter(
        (p) => distance(p, { x: 500, y: 300 }) > v.ring + 17,
      );
      if (fallen.length) {
        if (fallen.length === 1)
          v.points[this.ids.find((id) => id !== fallen[0].id)!]++;
        this.event(
          fallen.length === 2 ? "DOUBLE RING-OUT" : "RING-OUT",
          fallen[0],
          "goal",
        );
        for (const p of [a, b]) this.respawn(p, now);
        v.resetUntil = now + 1300;
        if (Math.max(...Object.values(v.points)) >= 3) this.endRound(now);
      }
    } else if (v.game === "ball") this.ballStep(dt, now);
    else if (v.game === "core") {
      const locations = [
        { x: 500, y: 300 },
        { x: 500, y: 100 },
        { x: 500, y: 500 },
      ];
      v.objective = locations[Math.floor((now - v.startedAt) / 25000) % 3];
      const occupants = [a, b].filter((p) => distance(p, v.objective) < 86);
      if (occupants.length === 1) {
        const p = occupants[0];
        this.scoresBase[p.id] += dt * 10;
        v.points[p.id] = Math.floor(this.scoresBase[p.id]);
      }
    } else if (v.game === "grapple") {
      for (const p of [a, b]) {
        if (p.y > 730) this.respawn(p, now);
        for (let c = p.checkpoint + 1; c < v.checkpoints.length; c++)
          if (p.x >= v.checkpoints[c].x) p.checkpoint = c;
        v.points[p.id] = Math.max(v.points[p.id], Math.round(p.x));
        if (p.x > v.width - 150) {
          v.points[p.id] = v.width;
          this.event("FINISH LINE", p, "goal");
          this.endRound(now);
          return;
        }
      }
    } else if (v.game === "shadow") {
      const hunter = v.players[v.hunter],
        runner = v.players[this.ids.find((id) => id !== v.hunter)!];
      this.scoresBase[runner.id] += dt * 2;
      for (const relic of v.relics)
        if (!relic.taken && distance(runner, relic) < 35) {
          relic.taken = true;
          this.scoresBase[runner.id] += 70;
          runner.revealed = now + 1400;
          runner.stats.captures++;
          this.event("CACHE SECURED", relic);
        }
      v.points[runner.id] = Math.floor(this.scoresBase[runner.id]);
      if (
        distance(hunter, runner) < 37 &&
        now >= runner.invulnerable &&
        visible(hunter, runner, v.walls)
      ) {
        this.scoresBase[hunter.id] += 200 + Math.max(0, v.legEnds - now) / 180;
        v.points[hunter.id] = Math.floor(this.scoresBase[hunter.id]);
        hunter.stats.captures++;
        this.finishLeg(now);
      } else if (
        v.relics.every((r) => r.taken) &&
        distance(runner, { x: 120, y: 300 }) < 55
      ) {
        this.scoresBase[runner.id] += 180;
        v.points[runner.id] = Math.floor(this.scoresBase[runner.id]);
        this.finishLeg(now);
      } else if (now >= v.legEnds) this.finishLeg(now);
    }
  }
  private ballStep(dt: number, now: number) {
    const v = this.view,
      ball = v.ball;
    for (const p of Object.values(v.players)) {
      const d = distance(p, ball);
      if (d < 32) {
        const n = unit(ball.x - p.x || 0.1, ball.y - p.y);
        ball.x = p.x + n.x * 33;
        ball.y = p.y + n.y * 33;
        const hit = Math.max(60, p.vx * n.x + p.vy * n.y);
        ball.vx += n.x * hit * 1.2;
        ball.vy += n.y * hit * 1.2;
      }
    }
    ball.vx = clamp(ball.vx, -1200, 1200);
    ball.vy = clamp(ball.vy, -1200, 1200);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.vx *= Math.exp(-0.65 * dt);
    ball.vy *= Math.exp(-0.65 * dt);
    if (ball.y < 14 || ball.y > 586) {
      ball.y = clamp(ball.y, 14, 586);
      ball.vy *= -0.85;
    }
    if (ball.x < 12 || ball.x > 988) {
      if (ball.y > 220 && ball.y < 380) {
        const id = this.ids[ball.x > 500 ? 0 : 1];
        v.points[id]++;
        v.players[id].stats.goals++;
        this.event("GOAL", ball, "goal");
        v.ball = { x: 500, y: 300, vx: 0, vy: 0 };
        Object.values(v.players).forEach((p) => this.respawn(p, now));
        v.resetUntil = now + 1700;
        if (v.points[id] >= 5) this.endRound(now);
      } else {
        ball.x = clamp(ball.x, 14, 986);
        ball.vx *= -0.85;
      }
    }
  }
  private endRound(now: number) {
    const v = this.view;
    if (v.ended || v.transitionUntil) return;
    const [a, b] = this.ids;
    const winner =
      v.points[a] === v.points[b] ? null : v.points[a] > v.points[b] ? a : b;
    v.history.push({
      game: v.game,
      scores: { ...v.points },
      winner,
      stats: Object.fromEntries(
        this.ids.map((id) => [id, { ...v.players[id].stats }]),
      ),
    });
    if (v.series)
      for (const id of this.ids)
        v.seriesScore[id] += winner ? (winner === id ? 1 : 0) : 0.5;
    if (
      !v.series ||
      v.round >= 5 ||
      Math.max(...Object.values(v.seriesScore)) >= 3
    )
      v.ended = true;
    else {
      v.transitionUntil = now + 4000;
      this.event("ROUND COMPLETE", { x: 500, y: 300 }, "stage");
    }
  }
  scores() {
    return this.view.series
      ? Object.fromEntries(
          this.ids.map((id) => [id, this.view.seriesScore[id] * 2]),
        )
      : { ...this.view.points };
  }
  snapshot(viewer?: string): FrontierView {
    const v = structuredClone(this.view);
    if (
      v.game === "shadow" &&
      viewer === v.hunter &&
      !v.ended &&
      !v.transitionUntil
    ) {
      const hunter = v.players[viewer],
        other = this.ids.find((id) => id !== viewer)!,
        runner = v.players[other];
      const seen =
        v.now < runner.revealed ||
        (distance(hunter, runner) < (runner.input.secondary ? 125 : 245) &&
          visible(hunter, runner, v.walls));
      if (!seen) {
        runner.x = -1000;
        runner.y = -1000;
        runner.vx = runner.vy = 0;
        runner.hidden = true;
        runner.input = neutral();
        runner.facing = { x: 0, y: 0 };
      }
    }
    return v;
  }
}
