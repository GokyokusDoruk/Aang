import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { CollisionWorld, type AABB } from '../physics/CollisionWorld';
import type { ElementId } from '../abilities/elements';
import type { Combatant } from './Combatant';

export interface WallColumn {
  box: AABB;
  x: number;
  z: number;
  baseY: number;
  height: number;
}

export type WallState = 'rising' | 'standing' | 'sinking';

export interface Wall {
  id: number;
  ownerId: string;
  element: ElementId;
  columns: WallColumn[];
  hp: number;
  maxHp: number;
  age: number;
  state: WallState;
  stateTime: number;
  /** 0..1 yükselme / batma oranı (görsel ve çarpışma yüksekliği) */
  rise: number;
  hitFlash: number;
}

const easeOutBack = (t: number) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Bükülerek yaratılan yapılar (Task 3 toprak duvar; ileride buz duvarı vb.).
 * Her sütun CollisionWorld'e gerçek bir AABB olarak eklenir → siper, platform, mermi engeli.
 * Yükselirken üstünde duran karakteri kaldırır (zemin takibi sayesinde).
 */
export class WallSystem {
  readonly walls: Wall[] = [];
  private readonly byBox = new Map<AABB, Wall>();
  private nextId = 1;

  constructor(
    private readonly world: CollisionWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly combatants: Combatant[],
  ) {}

  /** Yükselen sütunun üstündeki karakterleri birlikte kaldır (toprak asansörü / fırlatma). */
  private carry(c: WallColumn, prevTop: number, newTop: number): void {
    if (newTop <= prevTop) return;
    const foot = GameConfig.player.radius * GameConfig.player.footprintScale;
    for (const k of this.combatants) {
      if (!k.alive) continue;
      const pos = k.controller.position;
      if (pos.y < prevTop - 0.15 || pos.y > newTop) continue;
      if (!CollisionWorld.circleOverlapsRect(pos.x, pos.z, foot, c.box)) continue;
      pos.y = newTop;
      if (k.controller.velocity.y < 0) k.controller.velocity.y = 0;
    }
  }

  /**
   * Nişana göre toprak duvar yerleştir. Duvar, caster→hedef doğrultusuna dik durur.
   * Hiç sütun konamazsa (boşluk) null döner.
   */
  placeEarthWall(ownerId: string, casterPos: Vector3, target: Vector3, aimDir: Vector3): Wall | null {
    const W = GameConfig.earth.wall;
    let hx = target.x - casterPos.x;
    let hz = target.z - casterPos.z;
    let dist = Math.hypot(hx, hz);
    if (dist < 1e-3) {
      hx = aimDir.x;
      hz = aimDir.z;
      dist = W.minDistance;
    }
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    dist = Math.min(W.maxDistance, Math.max(W.minDistance, dist));
    const cx = casterPos.x + hx * dist;
    const cz = casterPos.z + hz * dist;
    const px = -hz;
    const pz = hx;
    // Hedefin biraz üstünden aşağı zemin ara (platform / rampa üstüne de konabilir)
    const searchTop = Math.max(target.y, casterPos.y) + 1.5;

    const columns: WallColumn[] = [];
    const step = W.columnWidth * W.spacing;
    for (let i = 0; i < W.columns; i++) {
      const off = (i - (W.columns - 1) / 2) * step;
      const x = cx + px * off;
      const z = cz + pz * off;
      const ground = this.world.groundHeight(x, z, 0.15, searchTop);
      if (!Number.isFinite(ground) || ground < casterPos.y - 8) continue;
      // Uçlardaki sütunlar biraz daha kısa: doğal görünüm
      const edge = Math.abs(i - (W.columns - 1) / 2) / ((W.columns - 1) / 2 || 1);
      const height = W.height * (1 - 0.18 * edge * edge);
      const half = W.columnWidth / 2;
      const box: AABB = { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, minY: ground - 0.4, maxY: ground };
      columns.push({ box, x, z, baseY: ground, height });
    }
    if (columns.length === 0) return null;

    // Sahip başına sınır: en eskiyi batır
    const mine = this.walls.filter((w) => w.ownerId === ownerId && w.state !== 'sinking');
    if (mine.length >= W.maxPerCaster) this.startSinking(mine[0]);

    const wall: Wall = {
      id: this.nextId++,
      ownerId,
      element: 'earth',
      columns,
      hp: W.hp,
      maxHp: W.hp,
      age: 0,
      state: 'rising',
      stateTime: 0,
      rise: 0,
      hitFlash: 0,
    };
    for (const c of columns) {
      this.world.addBox(c.box);
      this.byBox.set(c.box, wall);
    }
    this.walls.push(wall);
    this.bus.emit('wall:spawn', { wallId: wall.id, ownerId });
    for (const c of columns) this.bus.emit('fx:burst', { point: new Vector3(c.x, c.baseY, c.z), element: 'earth', size: 0.5 });
    return wall;
  }

  wallOfBox(box: AABB | null): Wall | undefined {
    return box ? this.byBox.get(box) : undefined;
  }

  /** Mermi isabeti; kutu bir duvara aitse hasar uygular ve true döner. */
  damageByBox(box: AABB | null, amount: number, point: Vector3): boolean {
    const wall = this.wallOfBox(box);
    if (!wall || wall.state === 'sinking') return !!wall;
    wall.hp -= amount;
    wall.hitFlash = 0.12;
    this.bus.emit('wall:hit', { wallId: wall.id, point: point.clone(), amount });
    if (wall.hp <= 0) this.destroy(wall);
    return true;
  }

  clear(): void {
    for (const w of [...this.walls]) this.remove(w);
  }

  update(dt: number): void {
    const W = GameConfig.earth.wall;
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      w.age += dt;
      w.stateTime += dt;
      w.hitFlash = Math.max(0, w.hitFlash - dt);

      if (w.state === 'rising') {
        const t = Math.min(1, w.stateTime / W.riseTime);
        w.rise = easeOutBack(t);
        if (t >= 1) {
          w.rise = 1;
          w.state = 'standing';
          w.stateTime = 0;
        }
      } else if (w.state === 'standing') {
        if (w.age >= W.lifetime) this.startSinking(w);
      } else {
        const t = Math.min(1, w.stateTime / W.sinkTime);
        w.rise = 1 - t;
        if (t >= 1) {
          this.remove(w);
          continue;
        }
      }
      for (const c of w.columns) {
        const prevTop = c.box.maxY;
        c.box.maxY = c.baseY + c.height * Math.max(0, w.rise);
        this.carry(c, prevTop, c.box.maxY);
      }
    }
  }

  private startSinking(w: Wall): void {
    if (w.state === 'sinking') return;
    w.state = 'sinking';
    w.stateTime = 0;
  }

  private destroy(w: Wall): void {
    const centers = w.columns.map((c) => new Vector3(c.x, c.baseY + (c.box.maxY - c.baseY) / 2, c.z));
    this.bus.emit('wall:destroyed', { wallId: w.id, columns: centers, element: w.element });
    this.remove(w);
  }

  private remove(w: Wall): void {
    for (const c of w.columns) {
      this.world.removeBox(c.box);
      this.byBox.delete(c.box);
    }
    const i = this.walls.indexOf(w);
    if (i >= 0) this.walls.splice(i, 1);
  }
}
