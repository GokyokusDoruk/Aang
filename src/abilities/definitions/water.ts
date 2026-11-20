import { Vector3 } from 'three';
import { GameConfig } from '../../config/gameConfig';
import type { AbilityContext, AbilityDef } from '../types';
import { fireProjectile, horizontalAim } from './shared';

const T = GameConfig.abilities.tuning;
const C = GameConfig.abilities.charged;
const spreadAim = new Vector3();

/** Buz sarkacı: nişana küçük rastgele sapmayla (her tick güncel nişan: yönlendirilebilir). */
function icicle(ctx: AbilityContext): void {
  const I = GameConfig.water.icicle;
  const dist = ctx.origin.distanceTo(ctx.target);
  const spread = Math.tan((I.spreadDeg * Math.PI) / 180) * dist;
  spreadAim.copy(ctx.target);
  spreadAim.x += (Math.random() - 0.5) * 2 * spread;
  spreadAim.y += (Math.random() - 0.5) * 2 * spread;
  spreadAim.z += (Math.random() - 0.5) * 2 * spread;
  ctx.target.copy(spreadAim);
  fireProjectile(ctx, 'shard', 'water', I);
}
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
    charged: {
      id: 'icicleStream',
      name: 'Buz Sarkacı Akımı',
      kind: 'channel',
      ...C.icicleStream,
      tick: icicle,
    },
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
  {
    id: 'iceWall',
    element: 'water',
    slot: 'special',
    name: 'Buz Duvarı',
    description: 'Hemen önünde anında buz siperi yükselt. Kırılgandır; kırılınca parçaları yakındaki rakipleri üşütür.',
    tuning: T.iceWall,
    execute: (ctx) => ctx.services.walls.placeIceWall(ctx.caster.id, ctx.caster.position, ctx.target, ctx.direction) !== null,
  },
];
