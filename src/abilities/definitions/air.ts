import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { AbilityContext, AbilityDef } from '../types';
import { horizontalAim } from './shared';

const T = GameConfig.abilities.tuning;
const h = { x: 0, z: 0 };
const origin = new Vector3();
const dir = new Vector3();
const to = new Vector3();
const center = new Vector3();
const impulse = new Vector3();

/**
 * Şok Dalgası: önündeki koni içindeki rakipleri iter (yakındakileri her yönde),
 * koni içindeki rakip mermilerini geri savurur. Duvar arkasındakiler korunur.
 */
function shockwave(ctx: AbilityContext): void {
  const A = GameConfig.air.shockwave;
  const c = ctx.caster;
  origin.copy(c.position).setY(c.position.y + c.controller.height * 0.55);
  // Dalga hafif yukarı/aşağı nişan alabilir ama çoğunlukla yataydır
  dir.copy(ctx.direction);
  dir.y *= 0.5;
  dir.normalize();
  const cosHalf = Math.cos((A.coneHalfAngleDeg * Math.PI) / 180);

  for (const k of ctx.services.combatants) {
    if (!k.alive || k.id === c.id) continue;
    k.center(center);
    to.subVectors(center, origin);
    const d = to.length();
    if (d > A.range) continue;
    if (d > A.pointBlank && to.dot(dir) / d < cosHalf) continue;
    // Siper kontrolü: arada duvar/blok varsa dalga geçmez
    const blocker = ctx.world.raycast(origin, to.clone().divideScalar(d || 1), d);
    if (blocker && blocker.distance < d - k.radius) continue;
    const falloff = 1 - 0.5 * (d / A.range);
    impulse.set(to.x, 0, to.z);
    if (impulse.lengthSq() < 1e-4) impulse.set(dir.x, 0, dir.z);
    impulse.normalize().multiplyScalar(A.knockback * falloff);
    impulse.y = A.knockbackUp * falloff;
    k.takeDamage(A.damage, impulse, c.id, center);
  }

  const deflected = ctx.services.projectiles.deflectInCone(origin, dir, A.range, cosHalf, A.pointBlank, c.id, A.deflectSpeedMult);
  if (deflected > 0) ctx.bus.emit('projectile:deflect', { ownerId: c.id, count: deflected });
  ctx.bus.emit('fx:shockwave', {
    origin: origin.clone(),
    direction: dir.clone(),
    range: A.range,
    halfAngle: (A.coneHalfAngleDeg * Math.PI) / 180,
    element: 'air',
  });
}

export const airAbilities: AbilityDef[] = [
  {
    id: 'airShockwave',
    element: 'air',
    slot: 'primary',
    name: 'Şok Dalgası',
    description: 'Önündeki rakipleri iten, mermileri geri savuran rüzgar dalgası.',
    tuning: T.airShockwave,
    execute: shockwave,
  },
  {
    id: 'airLeap',
    element: 'air',
    slot: 'secondary',
    name: 'Rüzgar Sıçrayışı',
    description: 'Yukarı ve ileri fırla. Sonrasında zıplamayı basılı tut: yavaş süzül.',
    tuning: T.airLeap,
    execute: (ctx) => {
      horizontalAim(ctx, h);
      ctx.caster.controller.launch(h.x, h.z);
      const p = ctx.caster.position;
      ctx.bus.emit('fx:burst', { point: new Vector3(p.x, p.y + 0.05, p.z), element: 'air', size: 1 });
    },
  },
];
