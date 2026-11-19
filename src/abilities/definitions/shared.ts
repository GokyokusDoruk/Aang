import { Vector3 } from 'three';
import type { ProjectileSpec } from '../../combat/ProjectileSystem';
import type { ElementId } from '../elements';
import type { AbilityContext } from '../types';

const aim = new Vector3();

/**
 * Mermi fırlatma yardımcısı: hedefe nişan alır, merminin düşüşünü
 * uçuş süresine göre telafi eder. Tüm elementler kullanır.
 */
export function fireProjectile(ctx: AbilityContext, kind: string, element: ElementId, spec: ProjectileSpec, origin: Vector3 = ctx.origin): void {
  aim.subVectors(ctx.target, origin);
  const flight = aim.length() / spec.speed;
  aim.y += 0.5 * spec.gravity * flight * flight;
  if (aim.lengthSq() < 1e-6) aim.copy(ctx.direction);
  ctx.services.projectiles.spawn(kind, element, spec, ctx.caster.id, origin, aim.normalize());
}

/** Nişan yönünün yatay bileşeni (normalize). */
export function horizontalAim(ctx: AbilityContext, out: { x: number; z: number }): { x: number; z: number } {
  const l = Math.hypot(ctx.direction.x, ctx.direction.z) || 1;
  out.x = ctx.direction.x / l;
  out.z = ctx.direction.z / l;
  return out;
}
