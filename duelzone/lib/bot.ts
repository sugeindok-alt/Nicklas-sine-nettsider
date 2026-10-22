import type { CompetitionAction, CompetitionView } from "./competition";
export const difficulties = ["easy", "medium", "hard", "expert"] as const;
export type Difficulty = (typeof difficulties)[number];
export const BOT_LEVELS = {
  easy: { reaction: 850, aim: 0.065, memory: 0.72, horizon: 0.25 },
  medium: { reaction: 520, aim: 0.04, memory: 0.88, horizon: 0.45 },
  hard: { reaction: 340, aim: 0.022, memory: 0.97, horizon: 0.7 },
  expert: { reaction: 230, aim: 0.009, memory: 1, horizon: 1 },
};
export class BotDriver {
  private next = 0;
  private puzzle = "";
  private memory: number[] = [];
  private stage = 0;
  private direction = { dx: 0, dy: 0 };
  constructor(
    readonly id: string,
    readonly difficulty: Difficulty,
    private random = Math.random,
  ) {}
  think(view: CompetitionView, now: number): CompetitionAction | undefined {
    const p = view.players[this.id],
      level = BOT_LEVELS[this.difficulty];
    if (!p || view.ended || now < view.transitionUntil) return;
    if (view.stage !== this.stage) {
      this.stage = view.stage;
      this.next = now + level.reaction;
      this.memory = [];
      this.puzzle = "";
    }
    if ((view.puzzle?.id || "") !== this.puzzle) {
      this.puzzle = view.puzzle?.id || "";
      this.memory = [];
      this.next = Math.max(this.next, now + level.reaction);
    }
    if (view.puzzle?.sequence.length && !this.memory.length)
      this.memory = view.puzzle.sequence.map((n) =>
        this.random() < level.memory ? n : Math.floor(this.random() * 9),
      );
    if (now < this.next)
      return view.discipline === "dodge" ? this.direction : undefined;
    this.next = now + level.reaction * (0.85 + this.random() * 0.3);
    if (view.discipline === "dodge") {
      if (!p.hp) return;
      const candidates = [
        { dx: 0, dy: 0 },
        ...Array.from({ length: 8 }, (_, i) => ({
          dx: Math.cos((i * Math.PI) / 4),
          dy: Math.sin((i * Math.PI) / 4),
        })),
      ];
      let best = -Infinity,
        threat = false;
      const previousDirection = this.direction;
      for (const direction of candidates) {
        let score = 0;
        for (const fraction of [0.25, 0.5, 1]) {
          const time = level.horizon * fraction;
          const x = Math.max(
            0.025,
            Math.min(0.975, p.x + direction.dx * 0.45 * time),
          );
          const y = Math.max(
            0.025,
            Math.min(0.975, p.y + direction.dy * 0.45 * time),
          );
          score -= Math.hypot(x - 0.5, y - 0.5) * 0.16;
          for (const h of view.hazards) {
            const active = Math.max(
              0,
              time - Math.max(0, h.activeAt - now) / 1000,
            );
            const distance =
              Math.hypot(x - (h.x + h.vx * active), y - (h.y + h.vy * active)) -
              h.radius -
              0.022;
            if (distance < 0.05) score -= (0.05 - distance) * 60;
            if (
              Math.hypot(p.x - h.x, p.y - h.y) < h.radius + 0.09 &&
              now >= h.activeAt
            )
              threat = true;
          }
        }
        score +=
          0.025 *
          (direction.dx * previousDirection.dx +
            direction.dy * previousDirection.dy);
        if (score > best) {
          best = score;
          this.direction = direction;
        }
      }
      if (threat && now >= p.readyAt && this.difficulty !== "easy")
        return { ability: true };
      return this.direction;
    }
    if (view.discipline === "grid") {
      const candidates = view.tiles
        .map((owner, tile) => ({ owner, tile }))
        .filter(
          ({ owner, tile }) =>
            owner !== this.id &&
            !(view.fortified[tile] > now) &&
            [
              tile - 7,
              tile + 7,
              ...(tile % 7 ? [tile - 1] : []),
              ...(tile % 7 < 6 ? [tile + 1] : []),
            ].some((n) => n >= 0 && n < 49 && view.tiles[n] === this.id),
        );
      candidates.sort((a, b) => {
        const rank = ({ owner, tile }: typeof a) =>
          (owner ? 3 : 0) +
          (tile === view.bonusTile ? 15 : 0) -
          (Math.abs((tile % 7) - (view.bonusTile % 7)) +
            Math.abs(Math.floor(tile / 7) - Math.floor(view.bonusTile / 7))) *
            (this.difficulty === "easy" ? 0.1 : 1);
        return rank(b) - rank(a);
      });
      if (
        p.energy >= 3 &&
        p.lastTile === view.bonusTile &&
        !(view.fortified[p.lastTile] > now)
      )
        return { ability: true };
      const pick =
        this.difficulty === "easy"
          ? Math.floor(this.random() * Math.max(1, candidates.length))
          : 0;
      return candidates[pick] ? { tile: candidates[pick].tile } : undefined;
    }
    if (view.discipline === "clash") {
      if (p.energy >= 3 && now >= p.readyAt) return { ability: true };
      const targets = view.targets.filter((t) => t.kind !== "decoy");
      const target =
        targets.find((t) => t.kind === "power") ||
        targets[Math.floor(this.random() * targets.length)];
      if (!target) return;
      return {
        target: target.id,
        x: Math.max(
          0,
          Math.min(1, target.x + (this.random() - 0.5) * level.aim * 2),
        ),
        y: Math.max(
          0,
          Math.min(1, target.y + (this.random() - 0.5) * level.aim * 2),
        ),
      };
    }
    const puzzle = view.puzzle;
    if (!puzzle || p.solved || now < puzzle.revealUntil) return;
    if (puzzle.kind === "memory")
      return this.memory.length
        ? { puzzleId: puzzle.id, tile: this.memory[p.progress] }
        : undefined;
    const numbers = puzzle.prompt.match(/\d+/g)?.map(Number) || [];
    let answer: number;
    if (puzzle.kind === "logic") answer = numbers[0] * numbers[1] - numbers[2];
    else
      answer =
        numbers[2] - numbers[1] === numbers[1] - numbers[0]
          ? numbers[2] + numbers[1] - numbers[0]
          : numbers[2] * (numbers[1] / numbers[0]);
    let choice = puzzle.choices.indexOf(String(answer));
    if (this.random() > level.memory) choice = (choice + 1) % 4;
    return { puzzleId: puzzle.id, choice };
  }
}
