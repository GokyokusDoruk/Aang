import { Vector3 } from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { ElementId } from '../abilities/elements';
import type { Combatant } from './Combatant';
import type { WallSystem } from './WallSystem';

/** Mermi ayarları (gameConfig'teki nesneler doğrudan verilir). */
export interface ProjectileSpec {
  radius: number;
  speed: number;
  gravity: number;
  damage: number;
  knockback: number;
  knockbackUp: number;
  wallDamage: number;
  lifetime: number;
}

export interface Projectile {
  id: number;
  kind: string;
  element: ElementId;
  spec: ProjectileSpec;
  ownerId: string;
  position: Vector3;
  prevPosition: Vector3;
  velocity: Vector3;
  age: number;
  /** Görsel dönüş için sabit rastgele eksen */
  spin: Vector3;
}

const dir = new Vector3();
const probe = new Vector3();
const impulse = new Vector3();

/**
 * Genel mermi sistemi (kaya, ileride ateş topu / buz kıymığı).
 * Sabit adımda süpürme testi yapar: hızlı mermiler ince duvarlardan geçmez.
 * Dünyaya çarpınca duvar hasarı, karaktere çarpınca hasar + itme.
 */
export class ProjectileSystem {
  readonly list: Projectile[] = [];
  private nextId = 1;

  constructor(
    private readonly world: CollisionWorld,
    private readonly bus: EventBus<GameEvents>,
    private readonly combatants: Combatant[],
    private readonly walls: WallSystem,
  ) {}

  spawn(kind: string, element: ElementId, spec: ProjectileSpec, ownerId: string, origin: Vector3, direction: Vector3): Projectile {
    const p: Projectile = {
      id: this.nextId++,
      kind,
      element,
      spec,
      ownerId,
      position: origin.clone(),
      prevPosition: origin.clone(),
      velocity: direction.clone().normalize().multiplyScalar(spec.speed),
      age: 0,
      spin: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    };
    this.list.push(p);
    return p;
  }

  clear(): void {
    this.list.length = 0;
  }

  /**
   * Koni içindeki rakip mermilerini geri savur (Hava şok dalgası).
   * Mermi yeni sahibine geçer: sahibine geri dönüp ona hasar verebilir.
   */
  deflectInCone(origin: Vector3, direction: Vector3, range: number, cosHalf: number, pointBlank: number, newOwner: string, speedMult: number): number {
    let count = 0;
    for (const p of this.list) {
      if (p.ownerId === newOwner) continue;
      probe.subVectors(p.position, origin);
      const d = probe.length();
      if (d > range) continue;
      if (d > pointBlank && probe.dot(direction) / d < cosHalf) continue;
      const speed = p.velocity.length() * speedMult;
      if (d > 1e-3) probe.divideScalar(d).add(direction).normalize();
      else probe.copy(direction);
      p.velocity.copy(probe).multiplyScalar(speed);
      p.ownerId = newOwner;
      p.age = 0;
      count++;
    }
    return count;
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.prevPosition.copy(p.position);
      p.age += dt;
      if (p.age >= p.spec.lifetime) {
        this.list.splice(i, 1);
        continue;
      }
      p.velocity.y -= p.spec.gravity * dt;
      const speed = p.velocity.length();
      const travel = speed * dt;
      dir.copy(p.velocity).divideScalar(speed || 1);

      const r = p.spec.radius;
      const worldHit = this.world.raycast(p.position, dir, travel + r);
      const worldDist = worldHit ? Math.max(0, worldHit.distance - r) : Infinity;

      // Karakter isabeti: yol boyunca örnekleme (yarıçap adımlarıyla)
      let target: Combatant | null = null;
      let targetDist = Infinity;
      const maxS = Math.min(travel, worldDist);
      const stepLen = Math.max(0.05, r * 0.8);
      for (const c of this.combatants) {
        if (!c.alive || c.id === p.ownerId) continue;
        const cr = c.radius + r;
        for (let s = 0; s <= maxS + 1e-6; s += stepLen) {
          probe.copy(p.position).addScaledVector(dir, Math.min(s, maxS));
          const dx = probe.x - c.position.x;
          const dz = probe.z - c.position.z;
          if (dx * dx + dz * dz > cr * cr) continue;
          if (probe.y < c.position.y - r || probe.y > c.position.y + c.height + r) continue;
          if (s < targetDist) {
            targetDist = s;
            target = c;
          }
          break;
        }
      }

      if (target) {
        p.position.addScaledVector(dir, Math.min(targetDist, maxS));
        impulse.set(dir.x, 0, dir.z).normalize().multiplyScalar(p.spec.knockback);
        impulse.y = p.spec.knockbackUp;
        target.takeDamage(p.spec.damage, impulse, p.ownerId, p.position);
        this.bus.emit('projectile:impact', { kind: p.kind, element: p.element, point: p.position.clone(), normal: null, hitCombatant: true });
        this.list.splice(i, 1);
      } else if (worldHit) {
        p.position.copy(worldHit.point).addScaledVector(dir, -r * 0.5);
        this.walls.damageByBox(worldHit.box, p.spec.wallDamage, worldHit.point);
        this.bus.emit('projectile:impact', {
          kind: p.kind,
          element: p.element,
          point: worldHit.point.clone(),
          normal: worldHit.normal.clone(),
          hitCombatant: false,
        });
        this.list.splice(i, 1);
      } else {
        p.position.addScaledVector(dir, travel);
      }
    }
  }
}
