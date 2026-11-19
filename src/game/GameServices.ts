import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { Combatant } from '../combat/Combatant';
import type { ProjectileSystem } from '../combat/ProjectileSystem';
import type { WallSystem } from '../combat/WallSystem';

/** Yeteneklerin ve sistemlerin erişebildiği ortak oyun servisleri (render'dan bağımsız). */
export interface GameServices {
  world: CollisionWorld;
  bus: EventBus<GameEvents>;
  combatants: Combatant[];
  projectiles: ProjectileSystem;
  walls: WallSystem;
}
