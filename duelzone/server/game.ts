import { randomInt, randomUUID } from "node:crypto";
import type { CompetitionAction } from "../lib/competition";
import {
  GAME_INFO,
  markerPosition,
  type Game,
  type MatchState,
  type Mode,
  type Player,
  type Challenge,
} from "../lib/shared";

export type Action = CompetitionAction &
  Partial<import("../lib/frontier").Control> & {
    challengeId: string;
    x?: number;
    y?: number;
    choice?: number;
  };
export function scoreAction(
  game: Game,
  challenge: Challenge,
  elapsed: number,
  action: Action,
): { points: number; detail: string } {
  if (elapsed < 0 || elapsed > 5000)
    return { points: 0, detail: "Outside the round" };
  if (game === "reaction")
    return elapsed < 80
      ? { points: 0, detail: "Too early" }
      : {
          points: Math.max(0, Math.round(1000 - elapsed * 1.2)),
          detail: `${Math.round(elapsed)} ms`,
        };
  if (game === "aim") {
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y))
      return { points: 0, detail: "Miss" };
    const distance = Math.hypot(
      action.x! - challenge.x!,
      action.y! - challenge.y!,
    );
    if (distance > 0.065) return { points: 0, detail: "Miss" };
    return {
      points: Math.round(
        650 * (1 - distance / 0.065) + 350 * Math.max(0, 1 - elapsed / 2500),
      ),
      detail: `${Math.round((1 - distance / 0.065) * 100)}% accuracy`,
    };
  }
  if (game === "speed")
    return challenge.choices?.[action.choice ?? -1] === challenge.ink
      ? {
          points: Math.max(100, Math.round(1000 - elapsed * 0.3)),
          detail: `Correct · ${Math.round(elapsed)} ms`,
        }
      : { points: 0, detail: "Wrong color" };
  const accuracy = Math.max(
    0,
    1 - Math.abs(markerPosition(elapsed, challenge.period) - 0.5) * 2,
  );
  return {
    points: Math.round(1000 * accuracy ** 3),
    detail: `${Math.round(accuracy * 100)}% precision`,
  };
}

export class Match {
  state: MatchState;
  private timer?: ReturnType<typeof setTimeout>;
  private closing = false;
  constructor(
    players: Player[],
    game: Game,
    mode: Mode,
    protected broadcast: (state: MatchState) => void,
    private settle: (state: MatchState) => Promise<Record<string, number>>,
    private completed?: (match: Match) => Promise<void>,
    private timing = 1,
  ) {
    this.state = {
      id: randomUUID(),
      game,
      mode,
      phase: "intro",
      players,
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      answered: [],
      round: 0,
      rounds: GAME_INFO[game].rounds,
      serverNow: Date.now(),
      startedAt: Date.now(),
      deadline: Date.now() + 2400 * timing,
      challenge: null,
      feedback: {},
      winner: null,
      rematch: [],
    };
  }
  snapshot(_viewer?: string) {
    return { ...this.state, serverNow: Date.now() };
  }
  private emit() {
    this.broadcast(this.snapshot());
  }
  private later(fn: () => void, delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, delay * this.timing);
  }
  start() {
    this.emit();
    this.later(() => this.nextRound(), 2400);
  }
  private nextRound() {
    if (this.closing) return;
    this.state.round++;
    this.state.answered = [];
    this.state.feedback = {};
    this.state.phase = "waiting";
    this.state.challenge = { id: randomUUID() };
    this.state.deadline = 0;
    this.emit();
    this.later(
      () => this.activate(),
      this.state.game === "reaction" ? randomInt(1200, 3500) : 550,
    );
  }
  private activate() {
    if (this.closing) return;
    const s = this.state,
      c = s.challenge!;
    if (s.game === "aim") {
      c.x = randomInt(16, 85) / 100;
      c.y = randomInt(18, 83) / 100;
    }
    if (s.game === "speed") {
      c.choices = ["BLUE", "CORAL", "GREEN", "PURPLE"];
      c.ink = c.choices[randomInt(4)];
      c.word = c.choices[randomInt(4)];
    }
    if (s.game === "precision") c.period = randomInt(1400, 2200);
    s.phase = "active";
    s.startedAt = Date.now();
    s.deadline =
      s.startedAt +
      (s.game === "reaction" ? 1800 : s.game === "precision" ? 3500 : 2500) *
        this.timing;
    this.emit();
    if (s.answered.length === 2) {
      this.review();
      return;
    }
    this.later(
      () => {
        for (const p of s.players)
          if (!s.answered.includes(p.id)) {
            s.answered.push(p.id);
            s.feedback[p.id] = { points: 0, detail: "Time expired" };
          }
        this.review();
      },
      s.game === "reaction" ? 1800 : s.game === "precision" ? 3500 : 2500,
    );
  }
  action(userId: string, action: Action) {
    const s = this.state;
    if (
      this.closing ||
      !s.players.some((p) => p.id === userId) ||
      s.answered.includes(userId) ||
      action.challengeId !== s.challenge?.id
    )
      return;
    if (
      s.phase !== "active" &&
      !(s.phase === "waiting" && s.game === "reaction")
    )
      return;
    if (s.phase === "active" && Date.now() > s.deadline) return;
    const feedback =
      s.phase === "waiting"
        ? { points: 0, detail: "False start — wait for green" }
        : scoreAction(s.game, s.challenge!, Date.now() - s.startedAt, action);
    s.feedback[userId] = feedback;
    s.scores[userId] += feedback.points;
    s.answered.push(userId);
    this.emit();
    if (s.answered.length === 2) this.review();
  }
  private review() {
    clearTimeout(this.timer);
    this.state.phase = "review";
    this.state.deadline = Date.now() + 1100 * this.timing;
    this.emit();
    this.later(() => {
      if (this.state.round >= this.state.rounds) void this.finish();
      else this.nextRound();
    }, 1100);
  }
  async finish(forfeit?: string) {
    if (this.closing) return;
    this.closing = true;
    clearTimeout(this.timer);
    const [a, b] = this.state.players;
    this.state.winner = forfeit
      ? this.state.players.find((p) => p.id !== forfeit)!.id
      : this.state.scores[a.id] === this.state.scores[b.id]
        ? null
        : this.state.scores[a.id] > this.state.scores[b.id]
          ? a.id
          : b.id;
    this.state.reason = forfeit ? "Opponent left the match" : "Score";
    try {
      this.state.changes = await this.settle(this.state);
    } catch (error) {
      this.closing = false;
      this.timer = setTimeout(() => void this.finish(forfeit), 2000);
      console.error("Settlement retry", error);
      return;
    }
    this.state.phase = "finished";
    this.state.deadline = 0;
    this.emit();
    await this.completed?.(this);
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
