import type { Vector3 } from 'three';
import type { Combatant } from './Combatant';

/**
 * Işın ile karakterler (dikey silindir) arasındaki en yakın kesişim mesafesi.
 * Nişan ışınının karakter gövdesine "yapışması" için kullanılır.
 */
export function raycastCombatants(origin: Vector3, dir: Vector3, maxDist: number, list: readonly Combatant[], excludeId: string): number | null {
  let best: number | null = null;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-9) return null;
  for (const c of list) {
    if (!c.alive || c.id === excludeId) continue;
    const ox = origin.x - c.position.x;
    const oz = origin.z - c.position.z;
    const r = c.radius;
    const b = 2 * (ox * dir.x + oz * dir.z);
    const cc = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0 || t > maxDist || (best !== null && t >= best)) continue;
    const y = origin.y + dir.y * t;
    if (y < c.position.y || y > c.position.y + c.height) continue;
    best = t;
  }
  return best;
}
