import { Vector3 } from 'three';
import type { ArenaLayout, RampDir } from '../config/arenaLayout';

/**
 * Render'dan baÄŸÄ±msÄ±z, hafif statik Ã§arpÄ±ÅŸma dÃ¼nyasÄ±.
 * - Kutular: eksen hizalÄ± AABB (zemin, siper, platform, duvar...)
 * - Rampalar: dikdÃ¶rtgen alan Ã¼zerinde lineer yÃ¼kseklik fonksiyonu
 * Three.js yalnÄ±zca Vector3 matematiÄŸi iÃ§in kullanÄ±lÄ±r; sahne/mesh bilgisi yoktur.
 * Ä°leride Task 3'teki toprak duvarlar `addBox/removeBox` ile dinamik eklenir.
 */
export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Ramp {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseY: number;
  h: number;
  dir: RampDir;
}

export interface RayHit {
  distance: number;
  point: Vector3;
  normal: Vector3;
  /** Çarpılan kutu (rampa ise null) */
  box: AABB | null;
}

export class CollisionWorld {
  readonly boxes: AABB[] = [];
  readonly ramps: Ramp[] = [];

  constructor(layout: ArenaLayout) {
    for (const b of layout.boxes) {
      const y = b.y ?? 0;
      this.addBox({
        minX: b.x - b.w / 2,
        maxX: b.x + b.w / 2,
        minY: y,
        maxY: y + b.h,
        minZ: b.z - b.d / 2,
        maxZ: b.z + b.d / 2,
      });
    }
    for (const r of layout.ramps) {
      const alongX = r.dir === '+x' || r.dir === '-x';
      const sx = alongX ? r.l : r.w;
      const sz = alongX ? r.w : r.l;
      this.ramps.push({
        minX: r.x - sx / 2,
        maxX: r.x + sx / 2,
        minZ: r.z - sz / 2,
        maxZ: r.z + sz / 2,
        baseY: r.y ?? 0,
        h: r.h,
        dir: r.dir,
      });
    }
  }

  addBox(box: AABB): AABB {
    this.boxes.push(box);
    return box;
  }

  removeBox(box: AABB): void {
    const i = this.boxes.indexOf(box);
    if (i >= 0) this.boxes.splice(i, 1);
  }

  static circleOverlapsRect(cx: number, cz: number, r: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    const px = cx < b.minX ? b.minX : cx > b.maxX ? b.maxX : cx;
    const pz = cz < b.minZ ? b.minZ : cz > b.maxZ ? b.maxZ : cz;
    const dx = cx - px;
    const dz = cz - pz;
    return dx * dx + dz * dz < r * r;
  }

  /** RampanÄ±n 0..1 ilerleme parametresinin x/z gradyanÄ±. */
  private static rampGrad(r: Ramp): { gx: number; gz: number } {
    switch (r.dir) {
      case '+x':
        return { gx: 1 / (r.maxX - r.minX), gz: 0 };
      case '-x':
        return { gx: -1 / (r.maxX - r.minX), gz: 0 };
      case '+z':
        return { gx: 0, gz: 1 / (r.maxZ - r.minZ) };
      case '-z':
        return { gx: 0, gz: -1 / (r.maxZ - r.minZ) };
    }
  }

  private static rampT(r: Ramp, x: number, z: number): number {
    switch (r.dir) {
      case '+x':
        return (x - r.minX) / (r.maxX - r.minX);
      case '-x':
        return (r.maxX - x) / (r.maxX - r.minX);
      case '+z':
        return (z - r.minZ) / (r.maxZ - r.minZ);
      case '-z':
        return (r.maxZ - z) / (r.maxZ - r.minZ);
    }
  }

  /** (x,z) noktasÄ±ndaki en yÃ¼ksek rampa yÃ¼zeyi; rampa yoksa -Infinity. */
  rampHeightAt(x: number, z: number): number {
    let best = -Infinity;
    for (const r of this.ramps) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      const h = r.baseY + r.h * CollisionWorld.rampT(r, x, z);
      if (h > best) best = h;
    }
    return best;
  }

  /**
   * Karakter tabanÄ±nÄ±n altÄ±ndaki en yÃ¼ksek yÃ¼rÃ¼nebilir yÃ¼zey (maxY'den yÃ¼ksek olanlar yok sayÄ±lÄ±r).
   * HiÃ§ yÃ¼zey yoksa -Infinity (boÅŸluk).
   */
  groundHeight(x: number, z: number, footRadius: number, maxY: number): number {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (b.maxY > maxY || b.maxY <= best) continue;
      if (CollisionWorld.circleOverlapsRect(x, z, footRadius, b)) best = b.maxY;
    }
    const rh = this.rampHeightAt(x, z);
    if (rh <= maxY && rh > best) best = rh;
    return best;
  }

  /**
   * Silindir (daire + yÃ¼kseklik aralÄ±ÄŸÄ±) ile kutular arasÄ±nda yatay itme Ã§Ã¶zÃ¼mÃ¼.
   * Tepesi stepTop'un altÄ±nda kalan kutular engel sayÄ±lmaz (basamak Ã§Ä±kÄ±labilir).
   * Toplam itme vektÃ¶rÃ¼nÃ¼ outPush'a yazar; Ã§arpÄ±ÅŸma varsa true dÃ¶ner.
   */
  /** Silindir herhangi bir engel kutusuyla kesişiyor mu (pushOut ile aynı kurallar, konumu değiştirmez) */
  overlaps(x: number, z: number, r: number, feetY: number, headY: number, stepTop: number): boolean {
    for (const b of this.boxes) {
      if (b.maxY <= stepTop || b.minY >= headY || b.maxY <= feetY) continue;
      const px = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
      const pz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz < r * r - 1e-6) return true;
    }
    return false;
  }

  pushOut(pos: Vector3, r: number, feetY: number, headY: number, stepTop: number, outPush: Vector3): boolean {
    let hit = false;
    for (const b of this.boxes) {
      if (b.maxY <= stepTop || b.minY >= headY || b.maxY <= feetY) continue;
      const px = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
      const pz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
      const dx = pos.x - px;
      const dz = pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let mx = 0;
      let mz = 0;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        const push = r - d;
        mx = (dx / d) * push;
        mz = (dz / d) * push;
      } else {
        // Merkez kutunun iÃ§inde: en kÄ±sa eksenden dÄ±ÅŸarÄ± it.
        const left = pos.x - b.minX;
        const right = b.maxX - pos.x;
        const back = pos.z - b.minZ;
        const front = b.maxZ - pos.z;
        const m = Math.min(left, right, back, front);
        if (m === left) mx = -(left + r);
        else if (m === right) mx = right + r;
        else if (m === back) mz = -(back + r);
        else mz = front + r;
      }
      pos.x += mx;
      pos.z += mz;
      outPush.x += mx;
      outPush.z += mz;
      hit = true;
    }
    return hit;
  }

  /** YÃ¼kselirken kafanÄ±n Ã§arptÄ±ÄŸÄ± en alÃ§ak tavan; yoksa null. */
  ceilingY(x: number, z: number, r: number, headFrom: number, headTo: number): number | null {
    let best: number | null = null;
    for (const b of this.boxes) {
      if (b.minY < headFrom - 1e-4 || b.minY >= headTo) continue;
      if (!CollisionWorld.circleOverlapsRect(x, z, r, b)) continue;
      if (best === null || b.minY < best) best = b.minY;
    }
    return best;
  }

  /** IÅŸÄ±n testi (dir normalize olmalÄ±). BaÅŸlangÄ±Ã§ noktasÄ±nÄ± iÃ§eren kutular yok sayÄ±lÄ±r. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number): RayHit | null {
    let best = maxDist;
    let bestNormal: Vector3 | null = null;
    let bestBox: AABB | null = null;

    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];

    for (const b of this.boxes) {
      const mins = [b.minX, b.minY, b.minZ];
      const maxs = [b.maxX, b.maxY, b.maxZ];
      let tNear = -Infinity;
      let tFar = Infinity;
      let axis = -1;
      let sign = 0;
      let miss = false;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) {
          if (o[i] < mins[i] || o[i] > maxs[i]) {
            miss = true;
            break;
          }
          continue;
        }
        let t1 = (mins[i] - o[i]) / d[i];
        let t2 = (maxs[i] - o[i]) / d[i];
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tNear) {
          tNear = t1;
          axis = i;
          sign = d[i] > 0 ? -1 : 1;
        }
        if (t2 < tFar) tFar = t2;
        if (tNear > tFar) {
          miss = true;
          break;
        }
      }
      if (miss || tNear < 0 || tNear >= best || axis < 0) continue;
      best = tNear;
      bestBox = b;
      bestNormal = new Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    }

    for (const r of this.ramps) {
      const { gx, gz } = CollisionWorld.rampGrad(r);
      const hx = gx * r.h;
      const hz = gz * r.h;
      // f(p) = rampHeight(p) - p.y ; Ä±ÅŸÄ±n yukarÄ±dan gelmeli (f(o) < 0)
      const fo = r.baseY + r.h * CollisionWorld.rampT(r, origin.x, origin.z) - origin.y;
      if (fo >= 0) continue;
      const denom = hx * dir.x + hz * dir.z - dir.y;
      if (Math.abs(denom) < 1e-9) continue;
      const s = -fo / denom;
      if (s < 0 || s >= best) continue;
      const px = origin.x + dir.x * s;
      const pz = origin.z + dir.z * s;
      if (px < r.minX || px > r.maxX || pz < r.minZ || pz > r.maxZ) continue;
      best = s;
      bestBox = null;
      bestNormal = new Vector3(-hx, 1, -hz).normalize();
    }

    if (!bestNormal) return null;
    return {
      distance: best,
      point: origin.clone().addScaledVector(dir, best),
      normal: bestNormal,
      box: bestBox,
    };
  }
}
