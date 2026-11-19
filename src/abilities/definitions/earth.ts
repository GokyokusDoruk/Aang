import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { AbilityContext, AbilityDef } from '../types';
import { fireProjectile, horizontalAim } from './shared';

const T = GameConfig.abilities.tuning;
const origin = new Vector3();
const h = { x: 0, z: 0 };

/**
 * Kaya Fırlatma: yerdeyken kaya karakterin önünden, zeminden kopar;
 * havadayken elde oluşur. Hafif yay çizer, nişan düşüşü telafi eder.
 */
function throwRock(ctx: AbilityContext): void {
  const R = GameConfig.earth.rock;
  const c = ctx.caster;
  origin.copy(ctx.origin);
  if (c.grounded) {
    horizontalAim(ctx, h);
    origin.set(c.position.x + h.x * R.groundSpawnForward, c.position.y + 0.45, c.position.z + h.z * R.groundSpawnForward);
    ctx.bus.emit('fx:burst', { point: new Vector3(origin.x, c.position.y, origin.z), element: 'earth', size: 0.45 });
  }
  fireProjectile(ctx, 'rock', 'earth', R, origin);
}

export const earthAbilities: AbilityDef[] = [
  {
    id: 'earthRock',
    element: 'earth',
    slot: 'primary',
    name: 'Kaya Fırlatma',
    description: 'Yerden kopardığın kayayı nişan noktasına fırlat. Hasar + geri itme.',
    tuning: T.earthRock,
    execute: throwRock,
  },
  {
    id: 'earthWall',
    element: 'earth',
    slot: 'secondary',
    name: 'Toprak Duvar',
    description: 'Nişan bölgesinde yerden siper duvarı yükselt. Hasar alır, süre dolunca batar.',
    tuning: T.earthWall,
    execute: (ctx) => ctx.services.walls.placeEarthWall(ctx.caster.id, ctx.caster.position, ctx.target, ctx.direction) !== null,
  },
];
