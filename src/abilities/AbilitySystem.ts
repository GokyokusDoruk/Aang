import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameServices } from '../game/GameServices';
import { ELEMENT_ORDER, type ElementId } from './elements';
import type { AbilityRegistry } from './AbilityRegistry';
import type { AbilityCaster, AbilityContext, AbilityDef, AbilitySlot, ChargedAbility, GameEvents } from './types';

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
  /** 3. yetenek (E / mobilde 3. buton) */
  specialPressed: boolean;
  primaryHeld: boolean;
  secondaryHeld: boolean;
  specialHeld: boolean;
  /** true ise hazırlanan yetenek iptal edilir (örn. dash). */
  interrupt: boolean;
}

interface CastState {
  def: AbilityDef;
  elapsed: number;
}

/** Tuşa basıldı, kısa mı uzun mu olduğu henüz belli değil. */
interface HoldState {
  slot: AbilitySlot;
  def: AbilityDef;
  time: number;
  /** true: kısa basış bırakınca çalışır (ikincil); false: basınca hemen çalıştı (ana saldırı) */
  deferredTap: boolean;
}

/** Süren uzun basış (kanal / şarj). */
interface ChargedState {
  slot: AbilitySlot;
  def: AbilityDef;
  ch: ChargedAbility;
  elapsed: number;
  tickTimer: number;
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
  private hold: HoldState | null = null;
  private active: ChargedState | null = null;
  private readonly chargedCooldowns = new Map<ChargedAbility, number>();

  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly target = new Vector3();

  constructor(
    private readonly caster: AbilityCaster,
    private readonly registry: AbilityRegistry,
    private readonly services: GameServices,
    initialElement: ElementId = ELEMENT_ORDER[0],
  ) {
    this.activeElement = initialElement;
  }

  private get bus(): EventBus<GameEvents> {
    return this.services.bus;
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

  /** Uzun basış versiyonunun kalan bekleme süresi */
  chargedCooldownRemaining(ch: ChargedAbility): number {
    return this.chargedCooldowns.get(ch) ?? 0;
  }

  /** Uzun basış: 0 = hazır, 1 = yeni kullanıldı (yoksa 0) */
  chargedCooldownRatio(def: AbilityDef | undefined): number {
    const ch = def?.charged;
    if (!ch || ch.cooldown <= 0) return 0;
    return Math.min(1, this.chargedCooldownRemaining(ch) / ch.cooldown);
  }

  /** Süren uzun basış ve ilerlemesi (kanal: geçen süre oranı, şarj: dolma oranı). */
  get chargedActive(): { def: AbilityDef; charged: ChargedAbility; progress: number } | null {
    const a = this.active;
    if (!a) return null;
    return { def: a.def, charged: a.ch, progress: Math.min(1, a.elapsed / Math.max(1e-3, a.ch.maxDuration)) };
  }

  get switching(): boolean {
    return this.switchTimer > 0;
  }

  /** Hazırlık sırasında koşu hızı çarpanı. */
  get moveMultiplier(): number {
    if (this.active) return this.active.ch.moveMult;
    return this.cast ? this.cast.def.tuning.castMoveMult : 1;
  }

  canUse(slot: AbilitySlot): boolean {
    const def = this.slot(slot);
    return !!def && !this.cast && !this.active && this.switchTimer <= 0 && this.cooldownRemaining(def) <= 0;
  }

  // ------------------------------------------------------------ komutlar

  setElement(element: ElementId): void {
    if (element === this.activeElement) return;
    if (this.cast) this.cancelCast();
    if (this.active) this.endCharged(true);
    this.hold = null;
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
    this.hold = null;
    this.active = null;
    this.chargedCooldowns.clear();
  }

  update(dt: number, intent: AbilityIntent): void {
    const A = GameConfig.abilities;

    for (const [def, t] of this.cooldowns) {
      const n = t - dt;
      if (n <= 0) this.cooldowns.delete(def);
      else this.cooldowns.set(def, n);
    }
    for (const [ch, t] of this.chargedCooldowns) {
      const n = t - dt;
      if (n <= 0) this.chargedCooldowns.delete(ch);
      else this.chargedCooldowns.set(ch, n);
    }
    this.switchTimer = Math.max(0, this.switchTimer - dt);

    if (intent.interrupt) {
      this.cancelCast();
      if (this.active) this.endCharged(true);
      this.hold = null;
    }

    // Element seçimi
    let next = intent.selectElement;
    if (!next && intent.cycle !== 0) {
      const i = ELEMENT_ORDER.indexOf(this.activeElement);
      const n = ELEMENT_ORDER.length;
      next = ELEMENT_ORDER[(i + intent.cycle + n) % n];
    }
    if (next) this.setElement(next);

    // Süren uzun basış: diğer girdiler yok sayılır
    if (this.active) {
      this.updateCharged(dt, intent);
      return;
    }

    // Input buffer
    const pressedSlot: AbilitySlot | null = intent.primaryPressed
      ? 'primary'
      : intent.secondaryPressed
        ? 'secondary'
        : intent.specialPressed
          ? 'special'
          : null;
    if (pressedSlot) {
      const def = this.slot(pressedSlot);
      if (def?.charged) {
        // Kısa mı uzun mu? Ana saldırı basınca hemen çalışır; diğerleri bırakınca (ya da uzun basış beklemedeyse eşikte)
        const deferredTap = pressedSlot !== 'primary';
        this.hold = { slot: pressedSlot, def, time: 0, deferredTap };
        if (!deferredTap) this.bufferTap(pressedSlot);
      } else {
        this.hold = null;
        this.bufferTap(pressedSlot);
      }
    } else if (this.buffered) {
      this.buffered.timer -= dt;
      if (this.buffered.timer <= 0) this.buffered = null;
    }

    if (this.hold && !pressedSlot) this.updateHold(dt, intent);

    // Hazırlık ilerlemesi
    if (this.cast) {
      this.cast.elapsed += dt;
      if (this.cast.elapsed >= this.cast.def.tuning.castTime) this.complete();
    }

    // Yeni cast başlat
    if (!this.cast && !this.active && this.switchTimer <= 0) {
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

  private bufferTap(slot: AbilitySlot): void {
    this.buffered = { slot, timer: GameConfig.abilities.inputBuffer };
    this.reportIfBlocked(slot);
  }

  private heldOf(slot: AbilitySlot, intent: AbilityIntent): boolean {
    return slot === 'primary' ? intent.primaryHeld : slot === 'secondary' ? intent.secondaryHeld : intent.specialHeld;
  }

  private updateHold(dt: number, intent: AbilityIntent): void {
    const h = this.hold!;
    if (this.slot(h.slot) !== h.def) {
      this.hold = null;
      return;
    }
    const ch = h.def.charged!;
    if (!this.heldOf(h.slot, intent)) {
      // Kısa basış
      if (h.deferredTap) this.bufferTap(h.slot);
      this.hold = null;
      return;
    }
    h.time += dt;
    if (h.time < GameConfig.abilities.holdThreshold) return;
    if (this.chargedCooldownRemaining(ch) > 0) {
      // Uzun basış beklemede: kısa basış gibi davran
      if (h.deferredTap) this.bufferTap(h.slot);
      this.hold = null;
      return;
    }
    // Kısa basışın hazırlığı bitsin, sonra uzun basışa geç
    if (this.cast || this.switchTimer > 0) return;
    this.hold = null;
    this.startCharged(h.slot, h.def, ch);
  }

  private makeCtx(): AbilityContext {
    this.caster.getAim(this.origin, this.direction, this.target);
    return {
      caster: this.caster,
      origin: this.origin,
      direction: this.direction,
      target: this.target,
      world: this.services.world,
      bus: this.bus,
      services: this.services,
    };
  }

  private startCharged(slot: AbilitySlot, def: AbilityDef, ch: ChargedAbility): void {
    this.buffered = null;
    this.active = { slot, def, ch, elapsed: 0, tickTimer: 0 };
    ch.start?.(this.makeCtx());
    this.bus.emit('ability:chargedStart', { casterId: this.caster.id, ability: def, charged: ch });
    if (ch.kind === 'instant') this.endCharged(false);
  }

  private updateCharged(dt: number, intent: AbilityIntent): void {
    const a = this.active!;
    const held = this.heldOf(a.slot, intent);
    a.elapsed += dt;
    if (a.ch.kind === 'channel') {
      a.tickTimer -= dt;
      const interval = Math.max(1 / 120, a.ch.tickInterval ?? 0.1);
      while (a.tickTimer <= 0 && this.active === a) {
        a.ch.tick?.(this.makeCtx(), a.elapsed);
        a.tickTimer += interval;
      }
      if (this.active === a && (!held || a.elapsed >= a.ch.maxDuration)) this.endCharged(false);
    } else if (!held) {
      this.endCharged(false);
    }
  }

  /**
   * Uzun basışı bitir. Şarj iptal edilirse bekleme süresi harcanmaz;
   * kanal başladıysa (kullanıldı sayılır) iptalde de bekleme süresine girer.
   */
  private endCharged(cancelled: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const ch = a.ch;
    const charge = ch.kind === 'charge' ? Math.min(1, a.elapsed / Math.max(1e-3, ch.maxDuration)) : 1;
    const ctx = this.makeCtx();
    let used = true;
    if (ch.kind === 'channel') ch.end?.(ctx);
    else if (cancelled) used = false;
    else used = ch.release?.(ctx, charge) !== false;
    if (used && ch.cooldown > 0) this.chargedCooldowns.set(ch, ch.cooldown);
    this.bus.emit('ability:chargedEnd', {
      casterId: this.caster.id,
      ability: a.def,
      charged: ch,
      charge,
      cancelled: !used,
      origin: ctx.origin.clone(),
    });
  }

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
    const ok = def.execute?.({
      caster: this.caster,
      origin: this.origin,
      direction: this.direction,
      target: this.target,
      world: this.services.world,
      bus: this.bus,
      services: this.services,
    });
    if (ok === false) {
      this.bus.emit('ability:denied', { casterId: this.caster.id, slot: def.slot, reason: 'invalid' });
      return;
    }
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
