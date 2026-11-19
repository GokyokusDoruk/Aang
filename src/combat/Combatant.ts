import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { SpawnPoint } from '../config/arenaLayout';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { emptyFlags, type StepInput } from '../input/InputActions';
import type { PlayerController } from '../game/PlayerController';

export interface CombatantOptions {
  maxHp: number;
  /** Ölünce bu süre sonra otomatik doğar; null = doğmaz (raund mantığı yönetir). */
  respawnDelay: number | null;
  /** Test kuklası: kendi kendine hareket etmez. */
  dummy?: boolean;
}

export interface DamageOptions {
  /** Ek sersemletme süresi (s) — örn. yıldırım */
  stun?: number;
  /** Dokunulmazlığı yok say (örn. aynı patlamanın doğrudan + alan hasarı ayrımı) */
  ignoreInvuln?: boolean;
}

const IDLE_INPUT: StepInput = { moveX: 0, moveY: 0, held: emptyFlags(), pressed: emptyFlags() };
/** Arena dışına düşüşte son vuran bu süre içinde vurduysa eleme ona yazılır (s). */
const RINGOUT_CREDIT_TIME = 6;

/**
 * Hasar alabilen, itilebilen varlık (oyuncu, kukla, Task 6'da bot).
 * Hareketi PlayerController ile yapar; HP, dokunulmazlık, sersemleme,
 * ölüm (can / arena dışı) ve yeniden doğma burada.
 */
export class Combatant {
  hp: number;
  alive = true;
  /** Hasar alınca kısa vurgu süresi (görsel). */
  hitFlash = 0;
  /** >0 iken hasar almaz (hasar sonrası kısa süre + doğuş koruması). */
  invulnTimer = 0;
  /** Doğuş korumasında mı (görsel yanıp sönme için). */
  spawnProtected = false;
  /** Kukla için bakış yönü. */
  idleYaw = 0;
  lastDeathCause: 'hp' | 'ringout' | null = null;
  private respawnTimer = 0;
  private lastAttacker: string | null = null;
  private lastAttackTime = -Infinity;
  private clock = 0;
  private readonly tmp = new Vector3();
  private readonly scaled = new Vector3();

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

  get respawnRemaining(): number {
    return this.alive ? 0 : Math.max(0, this.respawnTimer);
  }

  /** Göğüs hizası (hasar sayısı / efekt için). */
  center(out: Vector3): Vector3 {
    return out.copy(this.controller.position).setY(this.controller.position.y + this.height * 0.6);
  }

  /**
   * Hasar + itme uygular. Dokunulmazsa hiçbir şey olmaz ve false döner.
   * İtme, eksik can oranıyla büyür (düşük canlı rakip daha uzağa savrulur).
   */
  takeDamage(amount: number, impulse: Vector3 | null, sourceId: string, point: Vector3, opts: DamageOptions = {}): boolean {
    if (!this.alive) return false;
    if (this.invulnTimer > 0 && !opts.ignoreInvuln) return false;
    const C = GameConfig.combat;

    const missing = 1 - this.hp / this.opts.maxHp;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.15;
    this.invulnTimer = Math.max(this.invulnTimer, C.invulnTime);
    this.spawnProtected = false;
    if (sourceId !== this.id) {
      this.lastAttacker = sourceId;
      this.lastAttackTime = this.clock;
    }

    if (impulse) {
      this.scaled.copy(impulse).multiplyScalar(1 + missing * C.lowHpKnockbackBonus);
      this.controller.applyKnockback(this.scaled);
    }
    const stun = C.hitStun + (opts.stun ?? 0);
    this.controller.knockbackTimer = Math.max(this.controller.knockbackTimer, stun);

    const killed = this.hp <= 0;
    this.bus.emit('combat:damage', { targetId: this.id, sourceId, amount, point: point.clone(), killed });
    if (killed) this.die('hp', sourceId);
    return true;
  }

  /** Hasarsız itme (örn. kendi patlamanın seni savurması). */
  push(impulse: Vector3): void {
    if (this.alive) this.controller.applyKnockback(impulse);
  }

  private die(cause: 'hp' | 'ringout', killerId: string | null): void {
    this.alive = false;
    this.lastDeathCause = cause;
    this.bus.emit('combat:death', { targetId: this.id, cause, killerId });
    if (this.opts.respawnDelay !== null) this.respawnTimer = this.opts.respawnDelay;
  }

  respawn(): void {
    this.controller.respawn(this.spawn);
    this.hp = this.opts.maxHp;
    this.alive = true;
    this.invulnTimer = GameConfig.combat.spawnInvuln;
    this.spawnProtected = true;
    this.lastAttacker = null;
    this.bus.emit('combat:respawn', { targetId: this.id });
  }

  /** Her fizik adımında; kuklalar burada hareket eder, oyuncu kontrolcüsünü input ile ayrıca günceller. */
  fixedUpdate(dt: number, lookAt?: Vector3): void {
    this.clock += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.invulnTimer <= 0) this.spawnProtected = false;

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

    // Arena dışına düşüş = yenilgi
    if (this.controller.fellOut) {
      this.controller.fellOut = false;
      const credited = this.clock - this.lastAttackTime <= RINGOUT_CREDIT_TIME ? this.lastAttacker : null;
      this.bus.emit('combat:ringout', { targetId: this.id });
      this.die('ringout', credited);
    }
  }
}
