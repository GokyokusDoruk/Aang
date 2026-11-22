import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { Combatant } from '../../combat/Combatant';
import type { AbilityContext, AbilityDef } from '../types';
import { fireProjectile } from './shared';

const T = GameConfig.abilities.tuning;
const C = GameConfig.abilities.charged;
const dir = new Vector3();
const probe = new Vector3();
const end = new Vector3();
const impulse = new Vector3();
const spreadAim = new Vector3();

/** Alev dili: nişana rastgele sapmayla (her tick güncel nişan: yönlendirilebilir). */
function flame(ctx: AbilityContext): void {
  const F = GameConfig.fire.flame;
  const dist = Math.min(ctx.origin.distanceTo(ctx.target), F.speed * F.lifetime);
  const spread = Math.tan((F.spreadDeg * Math.PI) / 180) * Math.max(3, dist);
  spreadAim.subVectors(ctx.target, ctx.origin).normalize().multiplyScalar(Math.max(3, dist)).add(ctx.origin);
  spreadAim.x += (Math.random() - 0.5) * 2 * spread;
  spreadAim.y += (Math.random() - 0.5) * 2 * spread;
  spreadAim.z += (Math.random() - 0.5) * 2 * spread;
  ctx.target.copy(spreadAim);
  fireProjectile(ctx, 'flame', 'fire', F);
}

/**
 * Yıldırım Hattı: nişan doğrultusunda anlık (hitscan) delici hat.
 * Yoldaki tüm rakiplere hasar + itme + sersemletme; ilk duvar/blokta durur ve ona hasar verir.
 */
function lightningLine(ctx: AbilityContext, charge = 0): void {
  const L0 = GameConfig.fire.lightning;
  const c01 = Math.max(0, Math.min(1, charge));
  const L = {
    ...L0,
    damage: L0.damage * (1 + (L0.chargedDamageMult - 1) * c01),
    knockback: L0.knockback * (1 + (L0.chargedKnockbackMult - 1) * c01),
    knockbackUp: L0.knockbackUp * (1 + (L0.chargedKnockbackMult - 1) * c01),
    stun: L0.stun + L0.chargedStunBonus * c01,
    width: L0.width * (1 + (L0.chargedWidthMult - 1) * c01),
    wallDamage: L0.wallDamage * (1 + (L0.chargedDamageMult - 1) * c01),
  };
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
  // Şarj arttıkça daha çok, kalın görünen şimşek kolu
  const bolts = 1 + Math.floor(c01 * 2.5);
  for (let i = 0; i < bolts; i++) ctx.bus.emit('fx:lightning', { from: ctx.origin.clone(), to: end.clone(), element: 'fire' });
}

const mouth = new Vector3();
const toT = new Vector3();

/** Ateş Nefesi: baş hizasından nişan yönünde koni; içindeki herkes hasar alır ve tutuşur. */
function breath(ctx: AbilityContext, charge: number): void {
  const B = GameConfig.fire.breath;
  const lerp = (a: number, b: number) => a + (b - a) * charge;
  const range = lerp(B.range, B.chargedRange);
  const half = (lerp(B.halfAngleDeg, B.chargedHalfAngleDeg) * Math.PI) / 180;
  const damage = lerp(B.damage, B.chargedDamage);
  const kb = lerp(B.knockback, B.chargedKnockback);
  const c = ctx.caster;
  mouth.copy(c.position).setY(c.position.y + c.controller.height * 0.88);
  dir.copy(ctx.direction);
  dir.y *= 0.6;
  dir.normalize();
  const cosHalf = Math.cos(half);
  for (const k of ctx.services.combatants) {
    if (!k.alive || k.id === c.id) continue;
    k.center(toT).sub(mouth);
    const d = toT.length();
    if (d > range + k.radius) continue;
    if (d > k.radius * 1.5 && toT.dot(dir) / d < cosHalf) continue;
    const block = ctx.world.raycast(mouth, toT.clone().divideScalar(d || 1), d);
    if (block && block.distance < d - k.radius) continue;
    impulse.set(dir.x, 0, dir.z).normalize().multiplyScalar(kb);
    impulse.y = 1.5;
    k.takeDamage(damage * (1 - 0.3 * (d / range)), impulse, c.id, k.center(new Vector3()), { burn: true });
  }
  ctx.bus.emit('fx:breath', { origin: mouth.clone(), direction: dir.clone(), range, halfAngle: half, charge });
}

export const fireAbilities: AbilityDef[] = [
  {
    id: 'fireBall',
    element: 'fire',
    slot: 'primary',
    name: 'Ateş Topu',
    description: 'Çarpınca patlayan ateş topu: hasar, itme, %50 tutuşturma. Yakında patlarsa seni de fırlatır (az hasar).',
    tuning: T.fireBall,
    execute: (ctx) => fireProjectile(ctx, 'fireball', 'fire', GameConfig.fire.ball),
    charged: {
      id: 'flameStream',
      name: 'Alev Akımı',
      kind: 'channel',
      ...C.flameStream,
      tick: flame,
    },
  },
  {
    id: 'lightningLine',
    element: 'fire',
    slot: 'secondary',
    name: 'Yıldırım Hattı',
    description: 'Nişan doğrultusunda ani, delici yıldırım: hasar, itme ve kısa sersemletme.',
    tuning: T.lightningLine,
    execute: (ctx) => lightningLine(ctx),
    charged: {
      id: 'lightningCharged',
      name: 'Yıldırım Şarjı',
      kind: 'charge',
      ...C.lightningCharged,
      release: (ctx, charge) => lightningLine(ctx, charge),
    },
  },
  {
    id: 'fireBreath',
    element: 'fire',
    slot: 'special',
    name: 'Ateş Nefesi',
    description: 'Ağzından kısa menzilli ateş konisi: yakındakileri yakar. Basılı tut: şarj et, menzil ve koni büyür.',
    tuning: T.fireBreath,
    execute: (ctx) => breath(ctx, 0),
    charged: {
      id: 'fireBreathCharged',
      name: 'Ejder Nefesi',
      kind: 'charge',
      ...C.fireBreathCharged,
      release: (ctx, charge) => breath(ctx, Math.max(0.25, charge)),
    },
  },
];
