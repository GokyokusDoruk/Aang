import type { Vector3 } from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { GameServices } from '../game/GameServices';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { ElementId } from './elements';

export type { GameEvents } from '../core/GameEvents';

export type AbilitySlot = 'primary' | 'secondary';

export interface AbilityTuning {
  cooldown: number;
  castTime: number;
  castMoveMult: number;
}

/**
 * Yeteneği kullanan varlık. Oyuncu ve (Task 6) bot aynı arayüzü uygular,
 * böylece AbilitySystem kimin kullandığını bilmez.
 */
export interface AbilityCaster {
  readonly id: string;
  /** Ayak tabanı */
  readonly position: Vector3;
  readonly grounded: boolean;
  /** Yeteneğin çıkış noktası, yönü (normalize) ve hedef noktası. */
  getAim(outOrigin: Vector3, outDirection: Vector3, outTarget: Vector3): void;
}

export interface AbilityContext {
  caster: AbilityCaster;
  origin: Vector3;
  direction: Vector3;
  target: Vector3;
  world: CollisionWorld;
  bus: EventBus<GameEvents>;
  services: GameServices;
}

export interface AbilityDef {
  id: string;
  element: ElementId;
  slot: AbilitySlot;
  name: string;
  description: string;
  /** gameConfig'teki nesneye referans: ayar değişikliği anında yansır. */
  tuning: AbilityTuning;
  /**
   * Cast tamamlandığında çalışır. `false` dönerse yetenek geçersiz sayılır
   * (örn. duvar boşluğa konamaz): cooldown harcanmaz, 'ability:denied' yayılır.
   * Tanımlı değilse yer tutucu efekt gösterilir.
   */
  execute?(ctx: AbilityContext): boolean | void;
}
