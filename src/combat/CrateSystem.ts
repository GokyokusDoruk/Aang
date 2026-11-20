import { Vector3 } from 'three';
import type { CollisionWorld, AABB } from '../physics/CollisionWorld';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../abilities/types';
import type { CrateDef } from '../config/arenaLayout';
import { GameConfig } from '../config/gameConfig';

export interface Crate {
  id: number;
  box: AABB;
  x: number;
  z: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  hitFlash: number;
  alive: boolean;
}

/**
 * Arenadaki kırılabilen tahta kasalar. Her kasa CollisionWorld'de gerçek bir kutudur
 * (siper + üstüne çıkılabilir); mermi / yıldırım isabetinde hasar alır, kırılınca kutu kalkar.
 * Her raund başında yeniden kurulur.
 */
export class CrateSystem {
  readonly crates: Crate[] = [];
  private readonly byBox = new Map<AABB, Crate>();

  constructor(
    private readonly world: CollisionWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly defs: CrateDef[],
  ) {
    this.reset();
  }

  /** Tüm kasaları kaldır ve yerleşim verisinden yeniden kur. */
  reset(): void {
    for (const c of this.crates) if (c.alive) this.world.removeBox(c.box);
    this.crates.length = 0;
    this.byBox.clear();
    this.defs.forEach((d, i) => {
      const s = d.size ?? 1.2;
      const y = d.y ?? 0;
      const box: AABB = { minX: d.x - s / 2, maxX: d.x + s / 2, minY: y, maxY: y + s, minZ: d.z - s / 2, maxZ: d.z + s / 2 };
      const hp = GameConfig.crate.hp;
      const crate: Crate = { id: i, box, x: d.x, z: d.z, y, size: s, hp, maxHp: hp, hitFlash: 0, alive: true };
      this.world.addBox(box);
      this.byBox.set(box, crate);
      this.crates.push(crate);
    });
  }

  /** Kutu bir kasaya aitse hasar uygular ve true döner. */
  damageByBox(box: AABB | null, amount: number, point: Vector3): boolean {
    const c = box ? this.byBox.get(box) : undefined;
    if (!c || !c.alive) return false;
    c.hp -= amount * GameConfig.crate.damageMult;
    c.hitFlash = 0.12;
    this.bus.emit('crate:hit', { crateId: c.id, point: point.clone() });
    if (c.hp <= 0) this.breakCrate(c);
    return true;
  }

  update(dt: number): void {
    for (const c of this.crates) c.hitFlash = Math.max(0, c.hitFlash - dt);
  }

  private breakCrate(c: Crate): void {
    // Üstündeki kasa da desteksiz kalırsa birlikte kırılır
    c.alive = false;
    this.world.removeBox(c.box);
    this.byBox.delete(c.box);
    this.bus.emit('crate:broken', { crateId: c.id, center: new Vector3(c.x, c.y + c.size / 2, c.z), size: c.size });
    for (const o of this.crates) {
      if (!o.alive || o === c) continue;
      if (Math.abs(o.y - (c.y + c.size)) < 0.05 && Math.abs(o.x - c.x) < c.size * 0.8 && Math.abs(o.z - c.z) < c.size * 0.8) this.breakCrate(o);
    }
  }
}
