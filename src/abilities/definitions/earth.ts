import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { AbilityContext, AbilityDef } from '../types';

const T = GameConfig.abilities.tuning;
const origin = new Vector3();
const aim = new Vector3();

/**
 * Kaya Fırlatma: yerdeyken kaya karakterin önünden, zeminden kopar;
 * havadayken elde oluşur. Hafif yay çizer, nişan düşüşü telafi eder.
 */
function throwRock(ctx: AbilityContext): void {
  const R = GameConfig.earth.rock;
  const c = ctx.caster;
  origin.copy(ctx.origin);
  if (c.grounded) {
    let hx = ctx.direction.x;
    let hz = ctx.direction.z;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    origin.set(c.position.x + hx * R.groundSpawnForward, c.position.y + 0.45, c.position.z + hz * R.groundSpawnForward);
    ctx.bus.emit('fx:burst', { point: new Vector3(origin.x, c.position.y, origin.z), element: 'earth', size: 0.45 });
  }
  // Yerçekimi telafisi: uçuş süresine göre hedefin biraz üstüne nişan al
  aim.subVectors(ctx.target, origin);
  const flight = aim.length() / R.speed;
  aim.y += 0.5 * R.gravity * flight * flight;
  if (aim.lengthSq() < 1e-6) aim.copy(ctx.direction);
  ctx.services.projectiles.spawn('rock', 'earth', R, c.id, origin, aim.normalize());
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
