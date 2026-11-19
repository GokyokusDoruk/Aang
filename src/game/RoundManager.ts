import { GameConfig } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { Combatant } from '../combat/Combatant';

export type RoundPhase = GameEvents['round:phase']['phase'];
type Reason = GameEvents['round:phase']['reason'];

/**
 * Raund akışı: geri sayım → savaş → raund sonu → (yeni raund | maç sonu).
 * Bir dövüşçü yenilince (can / arena dışı) raund biter; süre dolarsa can oranı yüksek olan kazanır.
 */
export class RoundManager {
  phase: RoundPhase = 'idle';
  round = 0;
  /** Faza göre kalan süre (geri sayım / raund sonu) */
  timer = 0;
  fightTime = 0;
  scores: Record<string, number> = {};
  winnerId: string | null = null;
  reason: Reason = null;

  constructor(
    private readonly bus: EventBus<GameEvents>,
    private readonly fighters: () => Combatant[],
    private readonly onResetRound: () => void,
  ) {
    bus.on('combat:death', (e) => this.onDeath(e.targetId, e.cause));
  }

  get inputLocked(): boolean {
    return this.phase !== 'fight';
  }

  get timeLeft(): number {
    return Math.max(0, GameConfig.match.roundTime - this.fightTime);
  }

  startMatch(): void {
    this.scores = {};
    for (const f of this.fighters()) this.scores[f.id] = 0;
    this.round = 0;
    this.nextRound();
  }

  stop(): void {
    this.phase = 'idle';
  }

  update(dt: number): void {
    const M = GameConfig.match;
    switch (this.phase) {
      case 'countdown':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'fight';
          this.fightTime = 0;
          this.emit();
        }
        break;
      case 'fight':
        this.fightTime += dt;
        if (this.fightTime >= M.roundTime) this.endByTime();
        break;
      case 'roundEnd':
        this.timer -= dt;
        if (this.timer <= 0) {
          const champion = Object.entries(this.scores).find(([, s]) => s >= M.roundsToWin);
          if (champion) {
            this.phase = 'matchEnd';
            this.winnerId = champion[0];
            this.emit();
          } else {
            this.nextRound();
          }
        }
        break;
      default:
        break;
    }
  }

  private nextRound(): void {
    this.round++;
    this.winnerId = null;
    this.reason = null;
    this.onResetRound();
    this.phase = 'countdown';
    this.timer = GameConfig.match.countdown;
    this.emit();
  }

  private onDeath(targetId: string, cause: 'hp' | 'ringout'): void {
    if (this.phase !== 'fight') return;
    const fighters = this.fighters();
    if (!fighters.some((f) => f.id === targetId)) return;
    const winner = fighters.find((f) => f.id !== targetId) ?? null;
    this.endRound(winner?.id ?? null, cause);
  }

  private endByTime(): void {
    const [a, b] = this.fighters();
    const ra = a.hp / a.opts.maxHp;
    const rb = b.hp / b.opts.maxHp;
    this.endRound(Math.abs(ra - rb) < 1e-3 ? null : ra > rb ? a.id : b.id, 'time');
  }

  private endRound(winnerId: string | null, reason: Reason): void {
    if (winnerId) this.scores[winnerId] = (this.scores[winnerId] ?? 0) + 1;
    this.winnerId = winnerId;
    this.reason = reason;
    this.phase = 'roundEnd';
    this.timer = GameConfig.match.roundEndDelay;
    this.emit();
  }

  private emit(): void {
    this.bus.emit('round:phase', {
      phase: this.phase,
      round: this.round,
      scores: { ...this.scores },
      winnerId: this.winnerId,
      reason: this.reason,
    });
  }
}
