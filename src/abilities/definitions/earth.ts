import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { AbilityContext, AbilityDef } from '../types';
import { fireProjectile, horizontalAim } from './shared';

const T = GameConfig.abilities.tuning;
const C = GameConfig.abilities.charged;
const origin = new Vector3();
const h = { x: 0, z: 0 };

/**
 * Kaya Fırlatma: yerdeyken kaya karakterin önünden, zeminden kopar;
 * havadayken elde oluşur. Hafif yay çizer, nişan düşüşü telafi eder.
 */
function throwRock(ctx: AbilityContext): void {
  const R = GameConfig.earth.rock;
  const c = ctx.caster;
  // Kendi duvarının yanındaysan: duvar kopar ve nişana fırlar
  const wallCenter = ctx.services.walls.takeThrowableWall(c.id, c.position);
  if (wallCenter) {
    fireProjectile(ctx, 'rock', 'earth', GameConfig.earth.wallThrow, wallCenter);
    ctx.bus.emit('fx:burst', { point: wallCenter, element: 'earth', size: 1.2 });
    return;
  }
  origin.copy(ctx.origin);
  if (c.grounded) {
    horizontalAim(ctx, h);
    origin.set(c.position.x + h.x * R.groundSpawnForward, c.position.y + 0.45, c.position.z + h.z * R.groundSpawnForward);
    ctx.bus.emit('fx:burst', { point: new Vector3(origin.x, c.position.y, origin.z), element: 'earth', size: 0.45 });
  }
  fireProjectile(ctx, 'rock', 'earth', R, origin);
}

/** Dev kaya: başının üstünde oluşur; şarj oranıyla güçlenir. */
function throwBoulder(ctx: AbilityContext, charge: number): void {
  const B = GameConfig.earth.boulder;
  const k = B.minChargePower + (1 - B.minChargePower) * Math.max(0, Math.min(1, charge));
  const spec = {
    ...B,
    damage: B.damage * k,
    splashDamage: B.splashDamage * k,
    knockback: B.knockback * k,
    splashKnockback: B.splashKnockback * k,
    radius: B.radius * (0.75 + 0.25 * k),
    fragments: Math.round(B.fragments * k),
  };
  const c = ctx.caster;
  origin.set(c.position.x, c.position.y + B.spawnHeight, c.position.z);
  fireProjectile(ctx, 'rock', 'earth', spec, origin);
  ctx.bus.emit('fx:burst', { point: new Vector3(c.position.x, c.position.y, c.position.z), element: 'earth', size: 1 });
}

export const earthAbilities: AbilityDef[] = [
  {
    id: 'earthRock',
    element: 'earth',
    slot: 'primary',
    name: 'Kaya Fırlatma',
    description: 'Kayayı nişana fırlat: hasar + itme, zemine çarptığı yerde 5 sn tepecik. Kendi duvarının yanındaysan duvarı fırlatır (2× hasar).',
    tuning: T.earthRock,
    execute: throwRock,
    charged: {
      id: 'boulder',
      name: 'Dev Kaya',
      kind: 'charge',
      ...C.boulder,
      release: (ctx, charge) => throwBoulder(ctx, charge),
    },
  },
  {
    id: 'earthWall',
    element: 'earth',
    slot: 'secondary',
    name: 'Toprak Duvar',
    description: 'Nişan bölgesinde yerden siper duvarı yükselt. Hasar alır, süre dolunca batar.',
    tuning: T.earthWall,
    execute: (ctx) => ctx.services.walls.placeEarthWall(ctx.caster.id, ctx.caster.position, ctx.target, ctx.direction) !== null,
    charged: {
      id: 'earthWave',
      name: 'Duvar Dizisi',
      kind: 'instant',
      ...C.earthWave,
      start: (ctx) => ctx.services.walls.startWave(ctx.caster.id, ctx.caster.position, ctx.target, ctx.direction),
    },
  },
];
