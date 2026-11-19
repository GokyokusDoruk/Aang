import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { SpawnPoint } from '../config/arenaLayout';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { emptyFlags, type StepInput } from '../input/InputActions';
import type { PlayerController } from '../game/PlayerController';

export interface CombatantOptions {
  maxHp: number;
  /** Ölünce bu süre sonra otomatik doğar; null = doğmaz (Task 5 raund mantığı yönetir). */
  respawnDelay: number | null;
  /** Test kuklası: kendi kendine hareket etmez. */
  dummy?: boolean;
}

const IDLE_INPUT: StepInput = { moveX: 0, moveY: 0, held: emptyFlags(), pressed: emptyFlags() };

/**
 * Hasar alabilen, itilebilen varlık (oyuncu, kukla, Task 6'da bot).
 * Hareketi PlayerController ile yapar; HP / ölüm / yeniden doğma burada.
 */
export class Combatant {
  hp: number;
  alive = true;
  /** Hasar alınca kısa vurgu süresi (görsel). */
  hitFlash = 0;
  /** Kukla için bakış yönü. */
  idleYaw = 0;
  private respawnTimer = 0;
  private readonly tmp = new Vector3();

  constructor(
    readonly id: string,
    readonly controller: PlayerController,
    private readonly bus: EventBus<GameEvents>,
    readonly opts: CombatantOptions,
    readonly spawn: SpawnPoint,
  ) {
    this.hp = opts.maxHp;
    this.idleYaw = spawn.yaw;
  }

  get position(): Vector3 {
    return this.controller.position;
  }

  get radius(): number {
    return GameConfig.player.radius;
  }

  get height(): number {
    return this.controller.height;
  }

  /** Göğüs hizası (hasar sayısı / efekt için). */
  center(out: Vector3): Vector3 {
    return out.copy(this.controller.position).setY(this.controller.position.y + this.height * 0.6);
  }

  takeDamage(amount: number, impulse: Vector3 | null, sourceId: string, point: Vector3): void {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.15;
    if (impulse) this.controller.applyKnockback(impulse);
    const killed = this.hp <= 0;
    this.bus.emit('combat:damage', { targetId: this.id, sourceId, amount, point: point.clone(), killed });
    if (killed) this.die();
  }

  private die(): void {
    this.alive = false;
    this.bus.emit('combat:death', { targetId: this.id });
    if (this.opts.respawnDelay !== null) this.respawnTimer = this.opts.respawnDelay;
  }

  respawn(): void {
    this.controller.respawn(this.spawn);
    this.hp = this.opts.maxHp;
    this.alive = true;
    this.bus.emit('combat:respawn', { targetId: this.id });
  }

  /** Kuklalar için tam adım; oyuncu kendi kontrolcüsünü input ile ayrıca günceller. */
  fixedUpdate(dt: number, lookAt?: Vector3): void {
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    if (!this.alive) {
      if (this.opts.respawnDelay !== null) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.respawn();
      }
      return;
    }

    if (this.opts.dummy) {
      if (lookAt) {
        this.tmp.subVectors(lookAt, this.position);
        this.idleYaw = Math.atan2(-this.tmp.x, -this.tmp.z);
      }
      this.controller.fixedUpdate(dt, IDLE_INPUT, this.idleYaw);
    }

    if (this.controller.fellOut) {
      this.controller.fellOut = false;
      this.hp = this.opts.maxHp;
      this.bus.emit('combat:ringout', { targetId: this.id });
    }
  }
}
