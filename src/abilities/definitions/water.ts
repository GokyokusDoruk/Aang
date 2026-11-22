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

/** Buz yolu başlat; snow = arkasında rakipleri yavaşlatıp yakan kar izi bırakır (uzun basış). */
function startIceRide(ctx: AbilityContext, snow: boolean): void {
  horizontalAim(ctx, h);
  ctx.caster.controller.startGlide(h.x, h.z, snow);
  const p = ctx.caster.position;
  ctx.bus.emit('fx:burst', { point: new Vector3(p.x, p.y + 0.1, p.z), element: 'water', size: snow ? 1 : 0.6 });
}

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
    name: 'Buz Yolu',
    description: 'Ayağının altında buzdan yol yaratıp üstünde kay. Yukarı bakınca yol yükselir, Space ile tırman. Yol 5 sn sonra erir.',
    tuning: T.iceGlide,
    execute: (ctx) => startIceRide(ctx, false),
    charged: {
      id: 'snowRide',
      name: 'Kar Yolu',
      kind: 'instant',
      ...C.snowRide,
      start: (ctx) => startIceRide(ctx, true),
    },
  },
  {
    id: 'waterHeal',
    element: 'water',
    slot: 'special',
    name: 'Şifa Suyu',
    description: 'Etrafında su döner, anında can verir. Basılı tut: su küresine gir, 5 sn sonra canın tam dolar (hareket edemezsin, itilemezsin).',
    tuning: T.waterHeal,
    execute: (ctx) => {
      ctx.services.combatants.find((k) => k.id === ctx.caster.id)?.healNow(GameConfig.water.heal.amount);
      const p = ctx.caster.position;
      ctx.bus.emit('fx:burst', { point: new Vector3(p.x, p.y + 0.1, p.z), element: 'water', size: 1 });
    },
    charged: {
      id: 'waterSphere',
      name: 'Su Küresi',
      kind: 'instant',
      ...C.waterSphere,
      start: (ctx) => {
        ctx.services.combatants.find((k) => k.id === ctx.caster.id)?.enterWaterSphere();
        const p = ctx.caster.position;
        ctx.bus.emit('fx:burst', { point: new Vector3(p.x, p.y + 0.5, p.z), element: 'water', size: 1.6 });
      },
    },
  },
];
