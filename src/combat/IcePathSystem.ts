import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { AABB, CollisionWorld } from '../physics/CollisionWorld';
import type { Combatant } from './Combatant';

/** Buz yolunun bir plakası: üst yüzeyi (x, y, z), yönü yaw, eğimi pitch. */
export interface IceSegment {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  /** Plaka boyu (yol doğrultusunda) ve genişliği */
  length: number;
  width: number;
  age: number;
  life: number;
  /** Kar izi: üstündeki / yanındaki rakipleri yavaşlatır ve az hasar verir */
  snow: boolean;
  /** Çarpışma kutusu (kurulunca); kuran oyuncuya hemen çarpmasın diye kısa gecikmeyle eklenir */
  box: AABB | null;
}

interface RideState {
  riding: boolean;
  lx: number;
  ly: number;
  lz: number;
  last: IceSegment | null;
}

const tmp = new Vector3();

/**
 * Buz Yolu (Su sağ tık): kayan oyuncunun ayağının altında, nişana göre yükselen / alçalan
 * buz plakaları bırakır. Plakalar birkaç saniye üstünde durulabilir, sonra erir.
 * Kayma bitince altında bir bitiş platformu oluşur: eriyene kadar havada durabilirsin.
 */
export class IcePathSystem {
  readonly list: IceSegment[] = [];
  private readonly rides = new Map<string, RideState>();
  private readonly snowTimers = new Map<string, number>();
  private nextId = 1;

  constructor(
    private readonly world: CollisionWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly combatants: Combatant[],
  ) {}

  clear(): void {
    for (const s of this.list) if (s.box) this.world.removeBox(s.box);
    this.list.length = 0;
    this.rides.clear();
    this.snowTimers.clear();
  }

  /** Noktanın altındaki zemin yüksekliği (yoksa 15 m aşağısı) — kar yağışı görseli için */
  groundBelow(x: number, z: number, fromY: number): number {
    const g = this.world.groundHeight(x, z, 0.05, fromY);
    return Number.isFinite(g) ? g : fromY - 15;
  }

  update(dt: number): void {
    const P = GameConfig.water.icePath;
    for (const c of this.combatants) this.track(c);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.age += dt;
      if (!s.box && s.age >= P.armDelay) this.arm(s);
      if (s.age >= s.life) {
        if (s.box) this.world.removeBox(s.box);
        this.list.splice(i, 1);
      }
    }

    this.updateSnow(dt);
  }

  private track(c: Combatant): void {
    const P = GameConfig.water.icePath;
    const ctl = c.controller;
    let r = this.rides.get(c.id);
    if (!r) {
      r = { riding: false, lx: 0, ly: 0, lz: 0, last: null };
      this.rides.set(c.id, r);
    }
    const riding = c.alive && ctl.glideTimer > 0;
    const p = ctl.position;
    if (riding && !r.riding) {
      r.lx = p.x;
      r.ly = p.y;
      r.lz = p.z;
      r.last = this.spawn(c.id, p.x, p.y, p.z, ctl.velocity.x, ctl.velocity.z, 0, P.spacing * 1.6, P.width, ctl.glideSnow);
    } else if (riding) {
      const dx = p.x - r.lx;
      const dy = p.y - r.ly;
      const dz = p.z - r.lz;
      const h = Math.hypot(dx, dz);
      if (Math.hypot(h, dy) >= P.spacing) {
        const pitch = Math.atan2(dy, Math.max(1e-3, h));
        // Plaka iki ayak izinin ortasında, eğimi yol boyunca
        r.last = this.spawn(c.id, (p.x + r.lx) / 2, (p.y + r.ly) / 2, (p.z + r.lz) / 2, dx, dz, pitch, Math.hypot(h, dy) * 1.6, P.width, ctl.glideSnow);
        r.lx = p.x;
        r.ly = p.y;
        r.lz = p.z;
      }
    } else if (r.riding && c.alive) {
      // Kayma bitti: ayağının altına bitiş platformu, hız yumuşak düşer (platformdan uçup gitme)
      if (!ctl.grounded) {
        const end = this.spawn(c.id, p.x, p.y, p.z, ctl.velocity.x, ctl.velocity.z, 0, P.endPlatform, P.endPlatform, ctl.glideSnow);
        this.arm(end);
        const sp = ctl.horizontalSpeed;
        const max = GameConfig.player.runSpeed * 0.5;
        if (sp > max) {
          ctl.velocity.x *= max / sp;
          ctl.velocity.z *= max / sp;
        }
      }
      ctl.glideSnow = false;
      r.last = null;
    }
    r.riding = riding;
  }

  private spawn(ownerId: string, x: number, y: number, z: number, dirX: number, dirZ: number, pitch: number, length: number, width: number, snow: boolean): IceSegment {
    const P = GameConfig.water.icePath;
    const yaw = Math.hypot(dirX, dirZ) > 1e-3 ? Math.atan2(dirX, dirZ) : 0;
    const s: IceSegment = { id: this.nextId++, ownerId, x, y, z, yaw, pitch, length, width, age: 0, life: P.lifetime, snow, box: null };
    this.list.push(s);
    if (this.list.length > P.maxSegments) {
      const old = this.list.shift()!;
      if (old.box) this.world.removeBox(old.box);
    }
    return s;
  }

  /** Çarpışma kutusu: eğim yerine plakanın en alçak ucundaki yükseklikte, düz (eksen hizalı) kutu */
  private arm(s: IceSegment): void {
    if (s.box) return;
    const P = GameConfig.water.icePath;
    const half = Math.max(s.width, s.length * 0.62) / 2;
    const top = s.y + 0.02;
    s.box = this.world.addBox({
      minX: s.x - half,
      maxX: s.x + half,
      minZ: s.z - half,
      maxZ: s.z + half,
      minY: top - P.thickness,
      maxY: top,
    });
  }

  /** Kar izi: rakip plaka üstünde / yanındaysa periyodik küçük hasar + üşüme */
  private updateSnow(dt: number): void {
    const P = GameConfig.water.icePath;
    for (const [id, t] of this.snowTimers) {
      if (t - dt <= 0) this.snowTimers.delete(id);
      else this.snowTimers.set(id, t - dt);
    }
    for (const s of this.list) {
      if (!s.snow) continue;
      for (const c of this.combatants) {
        if (!c.alive || c.id === s.ownerId || this.snowTimers.has(c.id)) continue;
        const dx = c.position.x - s.x;
        const dz = c.position.z - s.z;
        if (dx * dx + dz * dz > P.snowRadius * P.snowRadius) continue;
        const dy = c.position.y - s.y;
        if (dy < -0.8 || dy > P.snowHeight) continue;
        this.snowTimers.set(c.id, P.snowTick);
        c.takeDamage(P.snowDamage, null, s.ownerId, c.center(tmp), { chill: P.snowChill, dot: true });
        this.bus.emit('fx:burst', { point: new Vector3(c.position.x, c.position.y + 0.2, c.position.z), element: 'water', size: 0.35 });
      }
    }
  }
}
