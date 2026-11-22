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
  /** Eklenecek üşüme yığını (buz kıymığı) */
  chill?: number;
  /** Dokunulmazlığı yok say (örn. aynı patlamanın doğrudan + alan hasarı ayrımı) */
  ignoreInvuln?: boolean;
  /** true: hedefi tutuştur (ateş) */
  burn?: boolean;
  /** Sürekli hasar (yanma): dokunulmazlık vermez, sersemletmez */
  dot?: boolean;
  /** Olayda hasar türü */
  kind?: 'burn' | 'self';
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
  /** Üşüme yığını (0..maxStacks); her yığın koşuyu yavaşlatır. */
  chillStacks = 0;
  /** >0 iken donmuş: hareket edemez. */
  frozenTimer = 0;
  /** Havaya fırlatıldı (duvar dizisi): kontrol yok, yere düşünce sersemler */
  launched = false;
  /** >0 iken yerde sersem: hareket / yetenek yok */
  downedTimer = 0;
  private launchAir = 0;
  /** >0 iken Şifa Suyu: can dolar */
  healTimer = 0;
  private healRate = 0;
  private healPop = 0;
  private healAcc = 0;
  /** Kalan yanma hasarı sayısı (0 = yanmıyor) */
  burnTicks = 0;
  private burnTimer = 0;
  private burnSource = '';
  private chillTimer = 0;
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
    if (this.invulnTimer > 0 && !opts.ignoreInvuln && !opts.dot) return false;
    if (opts.dot && this.spawnProtected) return false;
    const C = GameConfig.combat;

    const missing = 1 - this.hp / this.opts.maxHp;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = opts.dot ? 0.06 : 0.15;
    if (!opts.dot) {
      this.invulnTimer = Math.max(this.invulnTimer, C.invulnTime);
      this.spawnProtected = false;
    }
    if (sourceId !== this.id) {
      this.lastAttacker = sourceId;
      this.lastAttackTime = this.clock;
    }

    if (impulse) {
      this.scaled.copy(impulse).multiplyScalar(1 + missing * C.lowHpKnockbackBonus);
      this.controller.applyKnockback(this.scaled);
    }
    if (!opts.dot && sourceId !== this.id) {
      const stun = C.hitStun + (opts.stun ?? 0);
      this.controller.knockbackTimer = Math.max(this.controller.knockbackTimer, stun);
    }

    if (opts.chill && !this.dead()) this.addChill(opts.chill);
    if (opts.burn && !this.dead()) this.ignite(sourceId);

    const killed = this.hp <= 0;
    this.bus.emit('combat:damage', { targetId: this.id, sourceId, amount, point: point.clone(), killed, kind: opts.kind });
    if (killed) {
      // Kendi patlamanla ölürsen eleme son vurana yazılır
      const self = sourceId === this.id;
      const credited = self ? (this.clock - this.lastAttackTime <= RINGOUT_CREDIT_TIME ? this.lastAttacker : null) : sourceId;
      this.die('hp', credited);
    }
    return true;
  }

  /** Tutuştur: yanma sayacını yeniler (donmuşken tutuşmaz). Buz yanmayı söndürür. */
  ignite(sourceId: string): void {
    if (!this.alive || this.frozenTimer > 0) return;
    const B = GameConfig.fire.burn;
    if (this.burnTicks <= 0) this.burnTimer = B.interval;
    this.burnTicks = B.ticks;
    this.burnSource = sourceId;
    this.bus.emit('combat:burn', { targetId: this.id, sourceId, point: this.center(new Vector3()) });
  }

  get burning(): boolean {
    return this.burnTicks > 0;
  }

  /** Zamanla can yenile (yeniden kullanılırsa süre yenilenir). */
  startHeal(amount: number, duration: number): void {
    if (!this.alive) return;
    this.healTimer = duration;
    this.healRate = amount / duration;
    this.healPop = 0;
    this.healAcc = 0;
  }

  /** Hareket ve yetenek kilitli mi (donmuş, havaya fırlatılmış ya da yerde sersem) */
  get incapacitated(): boolean {
    return this.frozenTimer > 0 || this.launched || this.downedTimer > 0;
  }

  /** Görsel: 0 = ayakta, 1 = yerde yatıyor (düşüş hızlı, kalkış son 0.35 sn) */
  get downedPose(): number {
    if (this.downedTimer <= 0) return 0;
    const D = GameConfig.earth.wave.downTime;
    const fall = Math.min(1, (D - this.downedTimer) / 0.15);
    const up = Math.min(1, this.downedTimer / 0.35);
    return Math.min(fall, up);
  }

  /** Yerden fırlayan duvar: hasar + havaya at; havada süzülür, yere düşünce sersemler. */
  knockUp(amount: number, up: number, sourceId: string, point: Vector3): boolean {
    if (this.launched || this.downedTimer > 0) return false;
    const W = GameConfig.earth.wave;
    this.tmp.set(0, up, 0);
    if (!this.takeDamage(amount, this.tmp, sourceId, point)) return false;
    if (!this.alive) return true;
    this.controller.velocity.x *= 0.2;
    this.controller.velocity.z *= 0.2;
    this.controller.velocity.y = up;
    this.controller.gravityMult = W.floatGravityMult;
    this.controller.glideTimer = 0;
    this.launched = true;
    this.launchAir = 0;
    return true;
  }

  private dead(): boolean {
    return this.hp <= 0;
  }

  /** Üşüme yığını ekler; tam yığında kısa süre dondurur (donmuşken yığın birikmez). */
  addChill(stacks: number): void {
    const K = GameConfig.water.chill;
    if (this.frozenTimer > 0) return;
    this.chillStacks = Math.min(K.maxStacks, this.chillStacks + stacks);
    this.chillTimer = K.duration;
    this.burnTicks = 0; // buz yanmayı söndürür
    if (this.chillStacks >= K.maxStacks) {
      this.frozenTimer = K.freezeTime;
      this.controller.knockbackTimer = Math.max(this.controller.knockbackTimer, K.freezeTime);
      this.controller.velocity.x = 0;
      this.controller.velocity.z = 0;
      this.bus.emit('combat:frozen', { targetId: this.id, duration: K.freezeTime, point: this.center(new Vector3()) });
    }
    this.syncStatusSpeed();
  }

  /** Durum etkilerini temizle (doğuş / raund başı). */
  clearStatus(): void {
    this.healTimer = 0;
    this.burnTicks = 0;
    this.burnTimer = 0;
    this.launched = false;
    this.downedTimer = 0;
    this.controller.gravityMult = 1;
    this.clearChill();
  }

  private clearChill(): void {
    this.chillStacks = 0;
    this.chillTimer = 0;
    this.frozenTimer = 0;
    this.syncStatusSpeed();
  }

  private syncStatusSpeed(): void {
    const K = GameConfig.water.chill;
    this.controller.statusSpeedMultiplier = this.frozenTimer > 0 ? 0 : 1 - this.chillStacks * K.slowPerStack;
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
    this.clearStatus();
    this.bus.emit('combat:respawn', { targetId: this.id });
  }

  /** Her fizik adımında; kuklalar burada hareket eder, oyuncu kontrolcüsünü input ile ayrıca günceller. */
  fixedUpdate(dt: number, lookAt?: Vector3): void {
    this.clock += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.invulnTimer <= 0) this.spawnProtected = false;
    if (this.frozenTimer > 0) {
      this.frozenTimer -= dt;
      if (this.frozenTimer <= 0) this.clearChill();
    } else if (this.chillStacks > 0) {
      this.chillTimer -= dt;
      if (this.chillTimer <= 0) this.clearChill();
    }
    if (this.healTimer > 0 && this.alive) {
      const step = Math.min(dt, this.healTimer);
      this.healTimer -= dt;
      const before = this.hp;
      this.hp = Math.min(this.opts.maxHp, this.hp + this.healRate * step);
      this.healAcc += this.hp - before;
      this.healPop -= dt;
      if ((this.healPop <= 0 || this.healTimer <= 0) && this.healAcc >= 0.5) {
        this.healPop = GameConfig.water.heal.popInterval;
        this.bus.emit('combat:heal', { targetId: this.id, amount: this.healAcc, point: this.center(new Vector3()) });
        this.healAcc = 0;
      }
    }
    if (this.launched && this.alive) {
      const ctl = this.controller;
      this.launchAir += dt;
      ctl.knockbackTimer = Math.max(ctl.knockbackTimer, 0.1);
      if (this.launchAir > 0.2 && ctl.grounded && ctl.velocity.y <= 0) {
        const D = GameConfig.earth.wave.downTime;
        this.launched = false;
        ctl.gravityMult = 1;
        this.downedTimer = D;
        ctl.velocity.x = 0;
        ctl.velocity.z = 0;
        this.bus.emit('combat:downed', { targetId: this.id, duration: D, point: ctl.position.clone() });
      }
    } else if (this.downedTimer > 0) {
      this.downedTimer -= dt;
      this.controller.knockbackTimer = Math.max(this.controller.knockbackTimer, Math.max(0, this.downedTimer));
      this.controller.velocity.x = 0;
      this.controller.velocity.z = 0;
    }
    if (this.burnTicks > 0 && this.alive) {
      this.burnTimer -= dt;
      if (this.burnTimer <= 0) {
        const B = GameConfig.fire.burn;
        this.burnTicks--;
        this.burnTimer += B.interval;
        this.takeDamage(B.damagePerTick, null, this.burnSource, this.center(this.tmp), { dot: true, kind: 'burn' });
      }
    }

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
