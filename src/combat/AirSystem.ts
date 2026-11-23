import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Combatant } from './Combatant';

/** Yönlendirilebilir hortum (Hava sol tık uzun basış). */
export interface Tornado {
  id: number;
  ownerId: string;
  position: Vector3;
  prevPosition: Vector3;
  /** Sahibinin nişanı: hortum oraya doğru ilerler */
  target: Vector3;
  age: number;
  /** false: sahibi bıraktı, söner */
  active: boolean;
  /** 1 → 0 sönme */
  strength: number;
  hitTimers: Map<string, number>;
  /** Yakalanıp etrafında döndürülenler: açı ve yükselme */
  held: Map<string, { angle: number; rise: number }>;
}

const tmp = new Vector3();
const imp = new Vector3();

/**
 * Hava sistemleri: hortumlar ve dev rüzgar küresinin çarpması.
 * Render'dan bağımsız; AirView çizer.
 */
export class AirSystem {
  readonly tornados: Tornado[] = [];
  /** Dev küreyle uçarken bu uçuşta çarpılanlar (aynı rakip bir kez) */
  private readonly rammed = new Map<string, Set<string>>();
  private nextId = 1;

  constructor(
    private readonly world: CollisionWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly combatants: Combatant[],
  ) {}

  clear(): void {
    this.tornados.length = 0;
    this.rammed.clear();
  }

  spawnTornado(ownerId: string, from: Vector3, dirX: number, dirZ: number): Tornado {
    const T = GameConfig.air.tornado;
    const l = Math.hypot(dirX, dirZ) || 1;
    const x = from.x + (dirX / l) * T.spawnDistance;
    const z = from.z + (dirZ / l) * T.spawnDistance;
    const g = this.world.groundHeight(x, z, 0.2, from.y + 1.5);
    const p = new Vector3(x, Number.isFinite(g) ? g : from.y, z);
    const t: Tornado = { id: this.nextId++, ownerId, position: p, prevPosition: p.clone(), target: p.clone(), age: 0, active: true, strength: 1, hitTimers: new Map(), held: new Map() };
    this.tornados.push(t);
    return t;
  }

  steer(t: Tornado, target: Vector3): void {
    t.target.copy(target);
  }

  release(t: Tornado): void {
    t.active = false;
  }

  update(dt: number): void {
    this.updateTornados(dt);
    this.updateRams();
  }

  private updateTornados(dt: number): void {
    const T = GameConfig.air.tornado;
    for (let i = this.tornados.length - 1; i >= 0; i--) {
      const t = this.tornados[i];
      t.prevPosition.copy(t.position);
      t.age += dt;
      if (!t.active || t.age > T.maxLifetime) {
        // Hortum bitti: yakaladıklarını bırakır, düşerler
        if (t.held.size) this.releaseAll(t);
        t.strength -= dt / T.fadeTime;
        if (t.strength <= 0) {
          this.tornados.splice(i, 1);
          continue;
        }
      }
      // Nişana doğru yatay ilerle; zemini takip et (boşlukta yükseklik korunur)
      const dx = t.target.x - t.position.x;
      const dz = t.target.z - t.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const s = Math.min(d, T.speed * dt);
        const nx = t.position.x + (dx / d) * s;
        const nz = t.position.z + (dz / d) * s;
        const g = this.world.groundHeight(nx, nz, 0.2, t.position.y + 1.2);
        // Duvara çarparsa (çok yüksek zemin = engel) ilerlemez
        if (!(Number.isFinite(g) && g > t.position.y + 1.2)) {
          t.position.x = nx;
          t.position.z = nz;
          if (Number.isFinite(g)) t.position.y += (g - t.position.y) * Math.min(1, dt * 10);
        }
      }
      this.affect(t, dt);
    }
  }

  /** Yakalananları teğetsel savurarak bırak (yere düşünce sersem kalırlar). */
  private releaseAll(t: Tornado): void {
    const T = GameConfig.air.tornado;
    for (const [id, h] of t.held) {
      const c = this.combatants.find((k) => k.id === id);
      if (!c) continue;
      // Teğet yönünde (dönüş yönü) hafif savrulma
      imp.set(-Math.sin(h.angle) * T.releaseFling, T.releaseUp, Math.cos(h.angle) * T.releaseFling);
      c.releaseFromTornado(imp);
    }
    t.held.clear();
  }

  /** Yakalananı hortumun etrafında döndür ve yukarı taşı (hız ile; çarpışma kontrolcüde çözülür). */
  private orbit(t: Tornado, c: Combatant, h: { angle: number; rise: number }, dt: number): void {
    const T = GameConfig.air.tornado;
    h.angle += T.orbitSpeed * dt;
    h.rise = Math.min(T.riseHeight, h.rise + T.riseSpeed * dt);
    const R = T.orbitRadius;
    const tx = t.position.x + Math.cos(h.angle) * R;
    const tz = t.position.z + Math.sin(h.angle) * R;
    const ty = t.position.y + h.rise;
    const ctl = c.controller;
    const v = ctl.velocity;
    // Hedef noktaya yaklaş + dönüşün teğet hızı (gecikmesiz, düzgün daire)
    v.set((tx - ctl.position.x) * T.orbitPull - Math.sin(h.angle) * T.orbitSpeed * R, (ty - ctl.position.y) * T.orbitPull, (tz - ctl.position.z) * T.orbitPull + Math.cos(h.angle) * T.orbitSpeed * R);
    const max = T.orbitMaxSpeed;
    const s = v.length();
    if (s > max) v.multiplyScalar(max / s);
    ctl.knockbackTimer = Math.max(ctl.knockbackTimer, 0.1);
  }

  /**
   * Hortumun içindekiler: yakalanır, etrafında döner ve yukarı çıkar, aralıklarla az hasar alır.
   * Yakalanamayanlar (zırh, Su Küresi, zaten yerde) eskisi gibi dışa / yukarı savrulur.
   */
  private affect(t: Tornado, dt: number): void {
    const T = GameConfig.air.tornado;
    for (const [id, v] of t.hitTimers) {
      if (v - dt <= 0) t.hitTimers.delete(id);
      else t.hitTimers.set(id, v - dt);
    }
    for (const c of this.combatants) {
      if (c.id === t.ownerId) continue;
      const h = t.held.get(c.id);
      if (h) {
        if (!c.alive || !c.heldByTornado) {
          t.held.delete(c.id);
          c.releaseFromTornado(imp.set(0, 0, 0));
          continue;
        }
        this.orbit(t, c, h, dt);
        if (!t.hitTimers.has(c.id)) {
          t.hitTimers.set(c.id, T.hitInterval);
          c.takeDamage(T.damage * t.strength, null, t.ownerId, c.center(tmp), { element: 'air', ignoreInvuln: true });
        }
        continue;
      }
      if (!c.alive || t.hitTimers.has(c.id)) continue;
      const rx = c.position.x - t.position.x;
      const rz = c.position.z - t.position.z;
      const d = Math.hypot(rx, rz);
      if (d > T.radius + c.radius) continue;
      const dy = c.position.y - t.position.y;
      if (dy < -1 || dy > T.height) continue;
      t.hitTimers.set(c.id, T.hitInterval);
      if (t.active && t.age <= T.maxLifetime && c.captureByTornado(T.downTime)) {
        t.held.set(c.id, { angle: Math.atan2(rz, rx), rise: Math.max(0, dy) });
        c.takeDamage(T.damage, null, t.ownerId, c.center(tmp), { element: 'air' });
        continue;
      }
      const nx = d > 1e-3 ? rx / d : 1;
      const nz = d > 1e-3 ? rz / d : 0;
      // Dışa itme + teğetsel girdap + kaldırma
      imp.set(nx * T.push - nz * T.swirl, T.lift, nz * T.push + nx * T.swirl).multiplyScalar(t.strength);
      c.takeDamage(T.damage * t.strength, imp, t.ownerId, c.center(tmp), { element: 'air' });
    }
  }

  /** Dev rüzgar küresi: uçarken değdiği rakibe hasar + güçlü itme (uçuş başına bir kez). */
  private updateRams(): void {
    const S = GameConfig.air.sphere;
    for (const c of this.combatants) {
      const ctl = c.controller;
      if (!c.alive || ctl.sphereTimer <= 0 || !ctl.sphereBig) {
        this.rammed.delete(c.id);
        continue;
      }
      let hit = this.rammed.get(c.id);
      if (!hit) {
        hit = new Set();
        this.rammed.set(c.id, hit);
      }
      const r = S.radius * S.bigScale;
      // Küre karakterin altında
      tmp.copy(ctl.position).setY(ctl.position.y - r * 0.9);
      for (const k of this.combatants) {
        if (!k.alive || k === c || hit.has(k.id)) continue;
        k.center(imp);
        const off = imp.sub(tmp);
        const d = off.length();
        if (d > r + k.radius) continue;
        hit.add(k.id);
        off.y = 0;
        if (off.lengthSq() < 1e-4) off.set(ctl.velocity.x, 0, ctl.velocity.z);
        off.normalize().multiplyScalar(S.ramKnockback);
        off.y = S.ramKnockbackUp;
        k.takeDamage(S.ramDamage, off, c.id, k.center(new Vector3()), { element: 'air' });
        this.bus.emit('fx:burst', { point: k.center(new Vector3()), element: 'air', size: 1.2 });
      }
    }
  }
}
