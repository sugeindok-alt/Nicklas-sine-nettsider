export type Discipline = "dodge" | "grid" | "clash" | "mind";
export type CompetitionAction = {
  x?: number;
  y?: number;
  choice?: number;
  tile?: number;
  target?: string;
  puzzleId?: string;
  ability?: boolean;
  dx?: number;
  dy?: number;
};
export type Runner = {
  x: number;
  y: number;
  hp: number;
  shieldUntil: number;
  dashUntil: number;
  readyAt: number;
  combo: number;
  energy: number;
  focusUntil: number;
  progress: number;
  solved: boolean;
  lastInput: number;
  lastAction: number;
  dx: number;
  dy: number;
  lastTile: number;
};
export type Hazard = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  activeAt: number;
};
export type MovingTarget = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  kind: "normal" | "power" | "decoy";
};
export type Puzzle = {
  id: string;
  kind: "memory" | "pattern" | "logic";
  prompt: string;
  choices: string[];
  sequence: number[];
  length: number;
  revealUntil: number;
  expiresAt: number;
  number: number;
};
export type CompetitionView = {
  discipline: Discipline;
  stage: number;
  stages: number;
  stageEnds: number;
  transitionUntil: number;
  now: number;
  startedAt: number;
  ended: boolean;
  players: Record<string, Runner>;
  points: Record<string, number>;
  totals: Record<string, number>;
  hazards: Hazard[];
  targets: MovingTarget[];
  tiles: (string | null)[];
  fortified: Record<number, number>;
  bonusTile: number;
  bonusUntil: number;
  puzzle: Puzzle | null;
  notice: string;
};
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const modes: Discipline[] = ["dodge", "grid", "clash", "mind"];
export class Competition {
  view: CompetitionView;
  private previous: number;
  private spawnAt = 0;
  private serial = 0;
  private answer: number[] = [];
  private inputs = new Map<string, number[]>();
  private schedule: Discipline[];
  private bonusAt = 0;
  private base: Record<string, number> = {};
  private recap = false;
  constructor(
    readonly game: string,
    readonly ids: string[],
    now: number,
    private random = Math.random,
  ) {
    this.schedule =
      game === "arena"
        ? this.shuffle([...modes, "clash", "mind"] as Discipline[])
        : [game as Discipline];
    this.previous = now;
    this.view = {
      discipline: this.schedule[0],
      stage: 0,
      stages: this.schedule.length,
      stageEnds: now,
      transitionUntil: 0,
      now,
      startedAt: now,
      ended: false,
      players: {},
      points: {},
      totals: Object.fromEntries(ids.map((id) => [id, 0])),
      hazards: [],
      targets: [],
      tiles: [],
      fortified: {},
      bonusTile: 24,
      bonusUntil: now,
      puzzle: null,
      notice: "",
    };
    this.beginStage(now);
  }
  private number(max: number) {
    return Math.floor(this.random() * max);
  }
  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.number(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
  private beginStage(now: number) {
    const v = this.view;
    v.stage++;
    v.discipline = this.schedule[v.stage - 1];
    v.startedAt = now;
    v.now = now;
    v.transitionUntil = 0;
    v.stageEnds =
      now +
      (this.game === "arena"
        ? 12000
        : v.discipline === "dodge"
          ? 60000
          : v.discipline === "mind"
            ? 54000
            : 45000);
    v.points = Object.fromEntries(this.ids.map((id) => [id, 0]));
    this.base = { ...v.points };
    v.players = Object.fromEntries(
      this.ids.map((id, i) => [
        id,
        {
          x: i === 0 ? 0.32 : 0.68,
          y: 0.72,
          hp: 3,
          shieldUntil: now + 1000,
          dashUntil: 0,
          readyAt: now,
          combo: 0,
          energy: 0,
          focusUntil: 0,
          progress: 0,
          solved: false,
          lastInput: 0,
          lastAction: -1000,
          dx: 0,
          dy: 0,
          lastTile: i === 0 ? 42 : 48,
        },
      ]),
    );
    v.hazards = [];
    v.targets = [];
    v.tiles = Array(49).fill(null);
    v.fortified = {};
    v.puzzle = null;
    this.inputs.clear();
    this.ids.forEach((id, i) => (v.tiles[i === 0 ? 42 : 48] = id));
    v.bonusTile = 24;
    v.bonusUntil = now + 5000;
    this.spawnAt = now + 650;
    this.bonusAt = now + 1000;
    v.notice = {
      dodge: "Read the approach. Save your dash.",
      grid: "Expand from your territory. Hold the marked tile.",
      clash: "Chain hits. Avoid crossed targets.",
      mind: "Accuracy first. Then speed.",
    }[v.discipline];
    if (v.discipline === "clash") for (let i = 0; i < 5; i++) this.newTarget();
    if (v.discipline === "mind") this.nextPuzzle(now, 1);
    this.previous = now;
    this.recap = false;
  }
  private nextPuzzle(now: number, number: number) {
    const kind = (["memory", "pattern", "logic"] as const)[(number - 1) % 3];
    const sequence = Array.from(
      { length: Math.min(6, 3 + Math.floor(number / 3)) },
      () => this.number(9),
    );
    let choices: string[] = [],
      prompt = "Remember the sequence. Repeat it in order.";
    if (kind === "memory") this.answer = sequence;
    else {
      let correct: number, options: number[];
      if (kind === "pattern") {
        const start = 2 + this.number(8),
          step = 2 + this.number(5),
          multiplying = number > 3;
        const values = [0, 1, 2].map((i) =>
          multiplying ? start * 2 ** i : start + step * i,
        );
        correct = multiplying ? start * 8 : start + step * 3;
        prompt = values.join("  ·  ") + "  ·  ?";
        options = [correct, correct + step, correct - step, correct + 1];
      } else {
        const a = 2 + this.number(9),
          b = 2 + this.number(6),
          c = 1 + this.number(7);
        correct = a * b - c;
        prompt = `${a} × ${b} − ${c} = ?`;
        options = [correct, correct + b, correct - a, correct + 1];
      }
      choices = this.shuffle(options).map(String);
      this.answer = [choices.indexOf(String(correct))];
    }
    this.inputs.clear();
    for (const p of Object.values(this.view.players)) {
      p.progress = 0;
      p.solved = false;
    }
    this.view.puzzle = {
      id: `p-${++this.serial}`,
      kind,
      prompt,
      choices,
      sequence: kind === "memory" ? sequence : [],
      length: kind === "memory" ? sequence.length : 1,
      revealUntil:
        now + (kind === "memory" ? sequence.length * 650 + 500 : 600),
      expiresAt: Math.min(this.view.stageEnds, now + 8500),
      number,
    };
  }
  private newTarget() {
    const n = ++this.serial;
    this.view.targets.push({
      id: `t-${n}`,
      x: 0.15 + this.random() * 0.7,
      y: 0.15 + this.random() * 0.7,
      vx: (this.random() > 0.5 ? 1 : -1) * (0.08 + this.random() * 0.12),
      vy: (this.random() > 0.5 ? 1 : -1) * (0.06 + this.random() * 0.12),
      radius: n % 5 === 0 ? 0.045 : 0.055,
      kind: n % 7 === 0 ? "decoy" : n % 5 === 0 ? "power" : "normal",
    });
  }
  private spawnHazards(now: number) {
    const elapsed = (now - this.view.startedAt) / 1000;
    const edge = this.number(4),
      count = 1 + Math.min(4, Math.floor(elapsed / 12));
    for (let i = 0; i < count; i++) {
      const lane = 0.08 + this.random() * 0.84,
        speed = 0.19 + Math.min(0.25, elapsed / 180);
      this.view.hazards.push({
        id: `h-${++this.serial}`,
        x: edge === 0 ? -0.04 : edge === 1 ? 1.04 : lane,
        y: edge === 2 ? -0.04 : edge === 3 ? 1.04 : lane,
        vx: edge === 0 ? speed : edge === 1 ? -speed : 0,
        vy: edge === 2 ? speed : edge === 3 ? -speed : 0,
        radius: 0.022 + this.random() * 0.015,
        activeAt: now + 650,
      });
    }
    this.spawnAt = now + Math.max(320, 1050 - elapsed * 12);
  }
  tick(now: number) {
    const v = this.view;
    if (v.ended) return;
    v.now = now;
    if (this.recap) {
      if (now >= v.transitionUntil) this.beginStage(now);
      return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - this.previous) / 1000));
    this.previous = now;
    if (v.discipline === "dodge") {
      if (now >= this.spawnAt) this.spawnHazards(now);
      for (const h of v.hazards)
        if (now >= h.activeAt) {
          h.x += h.vx * dt;
          h.y += h.vy * dt;
        }
      v.hazards = v.hazards.filter(
        (h) => h.x > -0.1 && h.x < 1.1 && h.y > -0.1 && h.y < 1.1,
      );
      for (const id of this.ids) {
        const p = v.players[id];
        if (!p.hp) continue;
        if (now - p.lastInput > 300) {
          p.dx = 0;
          p.dy = 0;
        }
        const length = Math.max(1, Math.hypot(p.dx, p.dy)),
          speed = now < p.dashUntil ? 1.1 : 0.45;
        p.x = clamp(p.x + (p.dx / length) * speed * dt, 0.025, 0.975);
        p.y = clamp(p.y + (p.dy / length) * speed * dt, 0.025, 0.975);
        if (
          now >= p.shieldUntil &&
          v.hazards.some(
            (h) =>
              now >= h.activeAt &&
              Math.hypot(h.x - p.x, h.y - p.y) < h.radius + 0.022,
          )
        ) {
          p.hp--;
          p.shieldUntil = now + 1100;
          v.notice = p.hp
            ? "Hit taken. Reposition while protected."
            : "Runner eliminated.";
        }
        v.points[id] = Math.round((now - v.startedAt) / 10) + p.hp * 200;
      }
      const alive = this.ids.filter((id) => v.players[id].hp > 0);
      if (
        (this.ids.length > 1 ? alive.length <= 1 : alive.length === 0) &&
        now - v.startedAt > 1200
      ) {
        if (alive.length)
          v.points[alive[0]] = Math.max(...Object.values(v.points)) + 1000;
        this.endStage(now);
        return;
      }
    } else if (v.discipline === "clash") {
      for (const t of v.targets) {
        t.x += t.vx * dt;
        t.y += t.vy * dt;
        if (t.x < 0.07 || t.x > 0.93) {
          t.vx *= -1;
          t.x = clamp(t.x, 0.07, 0.93);
        }
        if (t.y < 0.07 || t.y > 0.93) {
          t.vy *= -1;
          t.y = clamp(t.y, 0.07, 0.93);
        }
      }
    } else if (v.discipline === "grid") {
      if (now >= v.bonusUntil) {
        v.bonusTile = 7 + this.number(35);
        v.bonusUntil = now + 5000;
      }
      if (now >= this.bonusAt) {
        const owner = v.tiles[v.bonusTile];
        if (owner) this.base[owner] += 60;
        this.bonusAt = now + 1000;
      }
      for (const id of this.ids)
        v.points[id] =
          v.tiles.filter((owner) => owner === id).length * 100 + this.base[id];
    } else if (
      v.puzzle &&
      (now >= v.puzzle.expiresAt ||
        this.ids.every((id) => v.players[id].solved))
    ) {
      if (v.puzzle.number >= (this.game === "arena" ? 2 : 6)) {
        this.endStage(now);
        return;
      }
      this.nextPuzzle(now, v.puzzle.number + 1);
    }
    if (now >= v.stageEnds) this.endStage(now);
  }
  private endStage(now: number) {
    if (this.recap || this.view.ended) return;
    const v = this.view;
    const cap = { dodge: 1800, grid: 1800, clash: 2500, mind: 1800 }[
      v.discipline
    ];
    for (const id of this.ids)
      v.totals[id] +=
        this.game === "arena"
          ? Math.min(1000, Math.round((v.points[id] / cap) * 1000))
          : v.points[id];
    if (v.stage >= v.stages) {
      v.ended = true;
      return;
    }
    this.recap = true;
    v.transitionUntil = now + 2000;
    v.notice = "Stage complete. Switch gears.";
  }
  action(id: string, action: CompetitionAction, now: number) {
    const v = this.view,
      p = v.players[id];
    if (!p || v.ended || this.recap || now >= v.stageEnds) return;
    if (action.ability) {
      if (now < p.readyAt) return;
      if (v.discipline === "dodge" && p.hp) {
        p.dashUntil = now + 220;
        p.shieldUntil = Math.max(p.shieldUntil, now + 220);
        p.readyAt = now + 4000;
      }
      if (
        v.discipline === "grid" &&
        p.energy >= 3 &&
        v.tiles[p.lastTile] === id
      ) {
        v.fortified[p.lastTile] = now + 4000;
        p.energy -= 3;
        p.readyAt = now + 1200;
      }
      if (v.discipline === "clash" && p.energy >= 3) {
        p.focusUntil = now + 3000;
        p.energy -= 3;
        p.readyAt = now + 4000;
      }
      return;
    }
    if (v.discipline === "dodge") {
      if (Number.isFinite(action.dx) && Number.isFinite(action.dy)) {
        p.dx = clamp(action.dx!, -1, 1);
        p.dy = clamp(action.dy!, -1, 1);
        p.lastInput = now;
      }
      return;
    }
    if (
      now - p.lastAction <
      (v.discipline === "grid" ? 260 : v.discipline === "clash" ? 120 : 140)
    )
      return;
    if (v.discipline === "grid") {
      const tile = action.tile;
      if (
        !Number.isInteger(tile) ||
        tile! < 0 ||
        tile! >= 49 ||
        v.tiles[tile!] === id ||
        (v.fortified[tile!] || 0) > now
      )
        return;
      const neighbours = [
        tile! - 7,
        tile! + 7,
        ...(tile! % 7 ? [tile! - 1] : []),
        ...(tile! % 7 < 6 ? [tile! + 1] : []),
      ];
      if (!neighbours.some((i) => i >= 0 && i < 49 && v.tiles[i] === id))
        return;
      p.lastAction = now;
      p.energy = Math.min(6, p.energy + 1);
      p.lastTile = tile!;
      v.tiles[tile!] = id;
      v.notice =
        tile === v.bonusTile
          ? "Bonus tile captured. Hold your ground."
          : "Territory captured.";
      for (const uid of this.ids)
        v.points[uid] =
          v.tiles.filter((owner) => owner === uid).length * 100 +
          this.base[uid];
    } else if (v.discipline === "clash") {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return;
      p.lastAction = now;
      const target = v.targets.find(
        (t) =>
          (!action.target || action.target === t.id) &&
          Math.hypot(t.x - action.x!, t.y - action.y!) <=
            t.radius * (now < p.focusUntil ? 1.5 : 1),
      );
      if (!target) {
        p.combo = 0;
        v.notice = "Miss. Reset and rebuild.";
        return;
      }
      v.targets = v.targets.filter((t) => t !== target);
      this.newTarget();
      if (target.kind === "decoy") {
        p.combo = 0;
        v.points[id] = Math.max(0, v.points[id] - 100);
        v.notice = "Decoy hit. −100 points.";
        return;
      }
      p.combo++;
      p.energy = Math.min(
        6,
        p.energy + (target.kind === "power" ? 2 : p.combo % 3 === 0 ? 1 : 0),
      );
      const multiplier = 1 + Math.min(3, Math.floor(p.combo / 4));
      v.points[id] += 100 * multiplier * (target.kind === "power" ? 2 : 1);
      v.notice =
        target.kind === "power"
          ? `Power target! ×${multiplier * 2}`
          : `${p.combo} hit streak · ×${multiplier}`;
    } else {
      const puzzle = v.puzzle;
      if (
        !puzzle ||
        action.puzzleId !== puzzle.id ||
        p.solved ||
        now < puzzle.revealUntil ||
        now >= puzzle.expiresAt
      )
        return;
      const choice = puzzle.kind === "memory" ? action.tile : action.choice;
      if (
        !Number.isInteger(choice) ||
        choice! < 0 ||
        choice! >= (puzzle.kind === "memory" ? 9 : 4)
      )
        return;
      p.lastAction = now;
      const sequence = this.inputs.get(id) || [];
      if (choice !== this.answer[sequence.length]) {
        p.combo = 0;
        p.progress = 0;
        this.inputs.set(id, []);
        p.lastAction = now + 650;
        v.notice = "Not quite. Reset and try again.";
        return;
      }
      sequence.push(choice!);
      this.inputs.set(id, sequence);
      p.progress = sequence.length;
      if (sequence.length === this.answer.length) {
        p.solved = true;
        p.combo++;
        v.points[id] +=
          500 +
          Math.round(
            300 *
              Math.max(
                0,
                1 -
                  (now - puzzle.revealUntil) /
                    (puzzle.expiresAt - puzzle.revealUntil),
              ),
          ) +
          Math.min(200, p.combo * 40);
        v.notice = "Solved. Clean execution.";
      }
    }
  }
  snapshot(): CompetitionView {
    const v = structuredClone(this.view);
    if (v.puzzle && v.now >= v.puzzle.revealUntil) v.puzzle.sequence = [];
    return v;
  }
  scores() {
    return Object.fromEntries(
      this.ids.map((id) => [
        id,
        this.view.ended || this.recap
          ? this.view.totals[id]
          : this.view.totals[id] +
            (this.game === "arena"
              ? Math.min(
                  1000,
                  Math.round(
                    (this.view.points[id] /
                      { dodge: 1800, grid: 1800, clash: 2500, mind: 1800 }[
                        this.view.discipline
                      ]) *
                      1000,
                  ),
                )
              : this.view.points[id]),
      ]),
    );
  }
}
