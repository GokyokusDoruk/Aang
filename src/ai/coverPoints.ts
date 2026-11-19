import { Vector3 } from 'three';
import type { ArenaLayout } from '../config/arenaLayout';
import type { CollisionWorld } from '../physics/CollisionWorld';

/**
 * Statik siperlerin (cover / pillar) etrafında bot için saklanma noktaları üretir.
 * Her kutunun 4 yüzü + 4 köşesi; zeminde, başka kutunun içinde olmayan ve arena içinde kalanlar.
 */
export function buildCoverPoints(layout: ArenaLayout, world: CollisionWorld): Vector3[] {
  const out: Vector3[] = [];
  const half = layout.size / 2 - 2.5;
  for (const b of layout.boxes) {
    if ((b.kind !== 'cover' && b.kind !== 'pillar') || (b.y ?? 0) !== 0) continue;
    const hw = b.w / 2 + 0.9;
    const hd = b.d / 2 + 0.9;
    const cands: [number, number][] = [
      [b.x + hw, b.z],
      [b.x - hw, b.z],
      [b.x, b.z + hd],
      [b.x, b.z - hd],
      [b.x + hw, b.z + hd],
      [b.x - hw, b.z + hd],
      [b.x + hw, b.z - hd],
      [b.x - hw, b.z - hd],
    ];
    for (const [x, z] of cands) {
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      // Zemin seviyesinde olmalı ve üstünde bir kutu (başka siper) olmamalı
      const ground = world.groundHeight(x, z, 0.45, 10);
      if (Math.abs(ground) > 0.05) continue;
      out.push(new Vector3(x, 0, z));
    }
  }
  return out;
}

const a = new Vector3();
const b = new Vector3();

/** Düşmanın göremeyeceği, bota yakın siper noktası; yoksa null. */
export function findCover(points: readonly Vector3[], world: CollisionWorld, me: Vector3, enemy: Vector3, maxDist = 16): Vector3 | null {
  let best: Vector3 | null = null;
  let bestScore = Infinity;
  for (const p of points) {
    const dMe = p.distanceTo(me);
    if (dMe > maxDist) continue;
    const dEnemy = Math.hypot(p.x - enemy.x, p.z - enemy.z);
    if (dEnemy < 4.5) continue;
    // Düşman göğsünden noktadaki göğüs hizasına görüş var mı?
    a.set(enemy.x, enemy.y + 1.1, enemy.z);
    b.set(p.x, p.y + 1.0, p.z).sub(a);
    const len = b.length();
    const hit = world.raycast(a, b.divideScalar(len), len);
    if (!hit || hit.distance > len - 0.3) continue;
    const score = dMe - dEnemy * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}
