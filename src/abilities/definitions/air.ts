import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { Tornado } from '../../combat/AirSystem';
import type { AbilityContext, AbilityDef } from '../types';
import { fireProjectile, horizontalAim } from './shared';

const T = GameConfig.abilities.tuning;
const C = GameConfig.abilities.charged;
const h = { x: 0, z: 0 };
const origin = new Vector3();
const dir = new Vector3();
const to = new Vector3();
const center = new Vector3();
const impulse = new Vector3();

/**
 * Şok Dalgası (E): önündeki koni içindeki rakipleri iter (yakındakileri her yönde),
 * koni içindeki rakip mermilerini geri savurur. Duvar arkasındakiler korunur.
 */
function shockwave(ctx: AbilityContext): void {
  const A = GameConfig.air.shockwave;
  const c = ctx.caster;
  origin.copy(c.position).setY(c.position.y + c.controller.height * 0.55);
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

/** Rüzgar küresi: nişan yönünde (yukarı / aşağı dahil) hızlı uçuş. */
function sphere(ctx: AbilityContext, big: boolean): void {
  ctx.caster.controller.startSphere(ctx.direction, big);
  const p = ctx.caster.position;
  ctx.bus.emit('fx:burst', { point: new Vector3(p.x, p.y + 0.05, p.z), element: 'air', size: big ? 1.6 : 1 });
}

/** Sahip başına süren hortum (kanal boyunca yönlendirilir). */
const tornados = new Map<string, Tornado>();

export const airAbilities: AbilityDef[] = [
  {
    id: 'airBall',
    element: 'air',
    slot: 'primary',
    name: 'Hava Topu',
    description: 'Çarptığı yerde küçük fırtına: az hasar, çarpma noktasından güçlü savurma. Yakında patlarsa seni de fırlatır.',
    tuning: T.airBall,
    execute: (ctx) => fireProjectile(ctx, 'airball', 'air', GameConfig.air.ball),
    charged: {
      id: 'tornado',
      name: 'Hortum',
      kind: 'channel',
      ...C.tornado,
      start: (ctx) => {
        horizontalAim(ctx, h);
        tornados.set(ctx.caster.id, ctx.services.air.spawnTornado(ctx.caster.id, ctx.caster.position, h.x, h.z));
      },
      tick: (ctx) => {
        const t = tornados.get(ctx.caster.id);
        if (t) ctx.services.air.steer(t, ctx.target);
      },
      end: (ctx) => {
        const t = tornados.get(ctx.caster.id);
        if (t) ctx.services.air.release(t);
        tornados.delete(ctx.caster.id);
      },
    },
  },
  {
    id: 'airSphere',
    element: 'air',
    slot: 'secondary',
    name: 'Rüzgar Küresi',
    description: 'Rüzgar küresi içinde baktığın yöne (yukarı / aşağı dahil) hızlı, kısa uçuş. Bitince zıplamayı basılı tut: süzül.',
    tuning: T.airSphere,
    execute: (ctx) => sphere(ctx, false),
    charged: {
      id: 'bigSphere',
      name: 'Dev Küre',
      kind: 'instant',
      ...C.bigSphere,
      start: (ctx) => sphere(ctx, true),
    },
  },
  {
    id: 'airShockwave',
    element: 'air',
    slot: 'special',
    name: 'Şok Dalgası',
    description: 'Önündeki rakipleri iten, gelen mermileri sahibine geri savuran rüzgar dalgası.',
    tuning: T.airShockwave,
    execute: shockwave,
  },
];
