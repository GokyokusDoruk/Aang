import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { Combatant } from '../../combat/Combatant';
import type { AbilityContext, AbilityDef } from '../types';
import { fireProjectile } from './shared';

const T = GameConfig.abilities.tuning;
const dir = new Vector3();
const probe = new Vector3();
const end = new Vector3();
const impulse = new Vector3();

/**
 * Yıldırım Hattı: nişan doğrultusunda anlık (hitscan) delici hat.
 * Yoldaki tüm rakiplere hasar + itme + sersemletme; ilk duvar/blokta durur ve ona hasar verir.
 */
function lightningLine(ctx: AbilityContext): void {
  const L = GameConfig.fire.lightning;
  const c = ctx.caster;
  dir.copy(ctx.direction).normalize();
  const wall = ctx.world.raycast(ctx.origin, dir, L.range);
  const length = wall ? wall.distance : L.range;
  end.copy(ctx.origin).addScaledVector(dir, length);

  // Yol boyunca örnekle; her hedef bir kez vurulur
  const hit = new Set<Combatant>();
  const step = 0.25;
  for (let s = 0; s <= length; s += step) {
    probe.copy(ctx.origin).addScaledVector(dir, s);
    for (const k of ctx.services.combatants) {
      if (!k.alive || k.id === c.id || hit.has(k)) continue;
      const rr = k.radius + L.width;
      const dx = probe.x - k.position.x;
      const dz = probe.z - k.position.z;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (probe.y < k.position.y - L.width || probe.y > k.position.y + k.height + L.width) continue;
      hit.add(k);
      impulse.set(dir.x, 0, dir.z).normalize().multiplyScalar(L.knockback);
      impulse.y = L.knockbackUp;
      k.takeDamage(L.damage, impulse, c.id, probe, { stun: L.stun });
    }
  }
  if (wall) ctx.services.walls.damageByBox(wall.box, L.wallDamage, wall.point);
  ctx.bus.emit('fx:lightning', { from: ctx.origin.clone(), to: end.clone(), element: 'fire' });
}

export const fireAbilities: AbilityDef[] = [
  {
    id: 'fireBall',
    element: 'fire',
    slot: 'primary',
    name: 'Ateş Topu',
    description: 'Çarpınca patlayan ateş topu: doğrudan hasar + alan hasarı ve itme.',
    tuning: T.fireBall,
    execute: (ctx) => fireProjectile(ctx, 'fireball', 'fire', GameConfig.fire.ball),
  },
  {
    id: 'lightningLine',
    element: 'fire',
    slot: 'secondary',
    name: 'Yıldırım Hattı',
    description: 'Nişan doğrultusunda ani, delici yıldırım: hasar, itme ve kısa sersemletme.',
    tuning: T.lightningLine,
    execute: lightningLine,
  },
];
