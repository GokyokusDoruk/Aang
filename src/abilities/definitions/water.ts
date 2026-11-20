import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { AbilityDef } from '../types';
import { fireProjectile, horizontalAim } from './shared';

const T = GameConfig.abilities.tuning;
const h = { x: 0, z: 0 };

export const waterAbilities: AbilityDef[] = [
  {
    id: 'waterShard',
    element: 'water',
    slot: 'primary',
    name: 'Buz Kıymığı',
    description: 'Hızlı, hafif buz mermisi. Basılı tutunca seri atış. İsabet üşütür: 3 isabette rakip kısa süre donar.',
    tuning: T.waterShard,
    execute: (ctx) => fireProjectile(ctx, 'shard', 'water', GameConfig.water.shard),
  },
  {
    id: 'iceGlide',
    element: 'water',
    slot: 'secondary',
    name: 'Buz Kayması',
    description: 'Düşük sürtünmeli akıcı süzülme. Geniş dönüşler, havada yavaş düşüş, buz izi.',
    tuning: T.iceGlide,
    execute: (ctx) => {
      horizontalAim(ctx, h);
      ctx.caster.controller.startGlide(h.x, h.z);
      const p = ctx.caster.position;
      ctx.bus.emit('fx:burst', { point: new Vector3(p.x, p.y + 0.1, p.z), element: 'water', size: 0.6 });
    },
  },
];
