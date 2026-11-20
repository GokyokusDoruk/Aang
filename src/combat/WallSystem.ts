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

/** Duvar türü ayarları (gameConfig.earth.wall, gameConfig.water.iceWall). */
export interface WallSpec {
  columns: number;
  columnWidth: number;
  spacing: number;
  height: number;
  riseTime: number;
  sinkTime: number;
  hp: number;
  lifetime: number;
  maxPerCaster: number;
  minDistance: number;
  maxDistance: number;
}

export interface Wall {
  id: number;
  ownerId: string;
  element: ElementId;
  spec: WallSpec;
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
  /** Duvara ait olmayan kutular için ek hasar alıcı (ör. kırılabilen kasalar). */
  extraDamage: ((box: AABB | null, amount: number, point: Vector3) => boolean) | null = null;
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
    return this.placeWall('earth', GameConfig.earth.wall, ownerId, casterPos, target, aimDir);
  }

  /** Buz duvarı: nişan yönünde, karakterin hemen önüne (mesafe sabit). */
  placeIceWall(ownerId: string, casterPos: Vector3, target: Vector3, aimDir: Vector3): Wall | null {
    return this.placeWall('water', GameConfig.water.iceWall, ownerId, casterPos, target, aimDir);
  }

  private placeWall(element: ElementId, W: WallSpec, ownerId: string, casterPos: Vector3, target: Vector3, aimDir: Vector3): Wall | null {
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
    const mine = this.walls.filter((w) => w.ownerId === ownerId && w.element === element && w.state !== 'sinking');
    if (mine.length >= W.maxPerCaster) this.startSinking(mine[0]);

    const wall: Wall = {
      id: this.nextId++,
      ownerId,
      element,
      spec: W,
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
    this.bus.emit('wall:spawn', { wallId: wall.id, ownerId, element });
    for (const c of columns) this.bus.emit('fx:burst', { point: new Vector3(c.x, c.baseY, c.z), element, size: 0.5 });
    return wall;
  }

  wallOfBox(box: AABB | null): Wall | undefined {
    return box ? this.byBox.get(box) : undefined;
  }

  /** Mermi isabeti; kutu bir duvara aitse hasar uygular ve true döner. */
  damageByBox(box: AABB | null, amount: number, point: Vector3): boolean {
    const wall = this.wallOfBox(box);
    if (!wall) return this.extraDamage?.(box, amount, point) ?? false;
    if (wall.state === 'sinking') return true;
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
    for (let i = this.walls.length - 1; i >= 0; i--) {
      const w = this.walls[i];
      const W = w.spec;
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
    if (w.element === 'water') this.shatterIce(w, centers);
    this.remove(w);
  }

  /** Kırılan buz duvarı parçaları yakındaki rakipleri üşütür (sahibi etkilenmez). */
  private shatterIce(w: Wall, centers: Vector3[]): void {
    const I = GameConfig.water.iceWall;
    const r2 = I.shatterRadius * I.shatterRadius;
    for (const k of this.combatants) {
      if (!k.alive || k.id === w.ownerId) continue;
      const p = k.position;
      if (centers.some((c) => (c.x - p.x) ** 2 + (c.z - p.z) ** 2 <= r2 && Math.abs(c.y - p.y) < 3)) k.addChill(I.shatterChill);
    }
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
