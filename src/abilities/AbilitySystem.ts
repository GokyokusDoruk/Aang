import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { ELEMENT_ORDER, type ElementId } from './elements';
import type { AbilityRegistry } from './AbilityRegistry';
import type { AbilityCaster, AbilityDef, AbilitySlot, GameEvents } from './types';

/**
 * Bir fizik adımında yetenek sistemine verilen niyet.
 * Oyuncu için input'tan, bot için AI'dan üretilir (cihazdan bağımsız).
 */
export interface AbilityIntent {
  selectElement: ElementId | null;
  /** -1 önceki, +1 sonraki element */
  cycle: number;
  primaryPressed: boolean;
  secondaryPressed: boolean;
  primaryHeld: boolean;
  /** true ise hazırlanan yetenek iptal edilir (örn. dash). */
  interrupt: boolean;
}

interface CastState {
  def: AbilityDef;
  elapsed: number;
}

/**
 * Her caster için bir tane. Aktif element, yetenek başına cooldown,
 * cast (hazırlık) süresi, input buffer ve element geçişini yönetir.
 * Cooldown'lar elemente değil yeteneğe bağlıdır: element değiştirmek cooldown'ı sıfırlamaz.
 */
export class AbilitySystem {
  activeElement: ElementId;

  private readonly cooldowns = new Map<AbilityDef, number>();
  private cast: CastState | null = null;
  private switchTimer = 0;
  private buffered: { slot: AbilitySlot; timer: number } | null = null;

  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly target = new Vector3();

  constructor(
    private readonly caster: AbilityCaster,
    private readonly registry: AbilityRegistry,
    private readonly bus: EventBus<GameEvents>,
    private readonly world: CollisionWorld,
    initialElement: ElementId = ELEMENT_ORDER[0],
  ) {
    this.activeElement = initialElement;
  }

  // ------------------------------------------------------------ sorgular (UI / AI)

  slot(slot: AbilitySlot): AbilityDef | undefined {
    return this.registry.get(this.activeElement, slot);
  }

  cooldownRemaining(def: AbilityDef): number {
    return this.cooldowns.get(def) ?? 0;
  }

  /** 0 = hazır, 1 = yeni kullanıldı */
  cooldownRatio(def: AbilityDef): number {
    const cd = def.tuning.cooldown;
    return cd > 0 ? Math.min(1, this.cooldownRemaining(def) / cd) : 0;
  }

  get castingAbility(): AbilityDef | null {
    return this.cast?.def ?? null;
  }

  get castProgress(): number {
    if (!this.cast) return 0;
    const t = this.cast.def.tuning.castTime;
    return t > 0 ? Math.min(1, this.cast.elapsed / t) : 1;
  }

  get switching(): boolean {
    return this.switchTimer > 0;
  }

  /** Hazırlık sırasında koşu hızı çarpanı. */
  get moveMultiplier(): number {
    return this.cast ? this.cast.def.tuning.castMoveMult : 1;
  }

  canUse(slot: AbilitySlot): boolean {
    const def = this.slot(slot);
    return !!def && !this.cast && this.switchTimer <= 0 && this.cooldownRemaining(def) <= 0;
  }

  // ------------------------------------------------------------ komutlar

  setElement(element: ElementId): void {
    if (element === this.activeElement) return;
    if (this.cast) this.cancelCast();
    this.activeElement = element;
    this.switchTimer = GameConfig.abilities.switchCooldown;
    this.buffered = null;
    this.bus.emit('element:changed', { casterId: this.caster.id, element });
  }

  cancelCast(): void {
    if (!this.cast) return;
    const ability = this.cast.def;
    this.cast = null;
    this.bus.emit('ability:cancel', { casterId: this.caster.id, ability });
  }

  /** Respawn / raund başı: cooldown ve cast temizlenir. */
  reset(): void {
    this.cast = null;
    this.cooldowns.clear();
    this.switchTimer = 0;
    this.buffered = null;
  }

  update(dt: number, intent: AbilityIntent): void {
    const A = GameConfig.abilities;

    for (const [def, t] of this.cooldowns) {
      const n = t - dt;
      if (n <= 0) this.cooldowns.delete(def);
      else this.cooldowns.set(def, n);
    }
    this.switchTimer = Math.max(0, this.switchTimer - dt);

    if (intent.interrupt) this.cancelCast();

    // Element seçimi
    let next = intent.selectElement;
    if (!next && intent.cycle !== 0) {
      const i = ELEMENT_ORDER.indexOf(this.activeElement);
      const n = ELEMENT_ORDER.length;
      next = ELEMENT_ORDER[(i + intent.cycle + n) % n];
    }
    if (next) this.setElement(next);

    // Input buffer
    const pressedSlot: AbilitySlot | null = intent.primaryPressed ? 'primary' : intent.secondaryPressed ? 'secondary' : null;
    if (pressedSlot) {
      this.buffered = { slot: pressedSlot, timer: A.inputBuffer };
      this.reportIfBlocked(pressedSlot);
    } else if (this.buffered) {
      this.buffered.timer -= dt;
      if (this.buffered.timer <= 0) this.buffered = null;
    }

    // Hazırlık ilerlemesi
    if (this.cast) {
      this.cast.elapsed += dt;
      if (this.cast.elapsed >= this.cast.def.tuning.castTime) this.complete();
    }

    // Yeni cast başlat
    if (!this.cast && this.switchTimer <= 0) {
      const slot = this.buffered?.slot ?? (intent.primaryHeld && A.primaryRepeatOnHold ? 'primary' : null);
      if (slot) {
        const def = this.slot(slot);
        if (!def) {
          this.buffered = null;
        } else if (this.cooldownRemaining(def) <= 0) {
          this.buffered = null;
          this.startCast(def);
        }
      }
    }
  }

  // ------------------------------------------------------------ iç

  private reportIfBlocked(slot: AbilitySlot): void {
    const def = this.slot(slot);
    const buffer = GameConfig.abilities.inputBuffer;
    let reason: GameEvents['ability:denied']['reason'] | null = null;
    if (!def) reason = 'empty';
    else if (this.switchTimer > buffer) reason = 'switching';
    else if (this.cooldownRemaining(def) > buffer) reason = 'cooldown';
    if (reason) this.bus.emit('ability:denied', { casterId: this.caster.id, slot, reason });
  }

  private startCast(def: AbilityDef): void {
    this.cast = { def, elapsed: 0 };
    this.bus.emit('ability:castStart', { casterId: this.caster.id, ability: def });
    if (def.tuning.castTime <= 0) this.complete();
  }

  private complete(): void {
    if (!this.cast) return;
    const def = this.cast.def;
    this.cast = null;
    this.caster.getAim(this.origin, this.direction, this.target);
    def.execute?.({
      caster: this.caster,
      origin: this.origin,
      direction: this.direction,
      target: this.target,
      world: this.world,
      bus: this.bus,
    });
    if (def.tuning.cooldown > 0) this.cooldowns.set(def, def.tuning.cooldown);
    this.bus.emit('ability:cast', {
      casterId: this.caster.id,
      ability: def,
      origin: this.origin.clone(),
      direction: this.direction.clone(),
      target: this.target.clone(),
    });
  }
}
