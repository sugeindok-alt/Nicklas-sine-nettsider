import { Match } from "./game";
import { markerPosition } from "../lib/shared";
import type { Difficulty } from "../lib/bot";
export class ClassicBotMatch extends Match {
  private botId = "";
  private difficulty: Difficulty = "medium";
  private loop?: ReturnType<typeof setInterval>;
  private round = "";
  private delay = 0;
  private error = 0;
  configureBot(id: string, difficulty: Difficulty) {
    this.botId = id;
    this.difficulty = difficulty;
  }
  start() {
    super.start();
    this.loop = setInterval(() => {
      const s = this.state,
        c = s.challenge;
      if (!c || s.phase !== "active" || s.answered.includes(this.botId)) return;
      const level = ["easy", "medium", "hard", "expert"].indexOf(
        this.difficulty,
      );
      if (this.round !== c.id) {
        this.round = c.id;
        this.delay =
          [520, 360, 240, 160][level] +
          Math.random() * [250, 180, 110, 60][level];
        this.error =
          (Math.random() * 2 - 1) * [0.055, 0.034, 0.016, 0.006][level];
      }
      const elapsed = Date.now() - s.startedAt;
      if (elapsed < this.delay) return;
      if (
        s.game === "precision" &&
        Math.abs(markerPosition(elapsed, c.period) - 0.5) >
          [0.26, 0.15, 0.07, 0.025][level]
      )
        return;
      this.action(this.botId, {
        challengeId: c.id,
        x: (c.x || 0.5) + this.error,
        y: (c.y || 0.5) + this.error / 2,
        choice:
          s.game === "speed"
            ? Math.random() < [0.76, 0.88, 0.96, 1][level]
              ? c.choices!.indexOf(c.ink!)
              : Math.floor(Math.random() * 4)
            : undefined,
      });
    }, 20);
  }
  async finish(forfeit?: string) {
    clearInterval(this.loop);
    await super.finish(forfeit);
  }
  dispose() {
    clearInterval(this.loop);
    super.dispose();
  }
}
