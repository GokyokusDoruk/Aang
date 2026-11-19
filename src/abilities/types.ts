import type { Vector3 } from 'three';
import type { EventBus } from '../core/EventBus';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { ElementId } from './elements';

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
  readonly position: Vector3;
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
}

export interface AbilityDef {
  id: string;
  element: ElementId;
  slot: AbilitySlot;
  name: string;
  description: string;
  /** gameConfig'teki nesneye referans: ayar değişikliği anında yansır. */
  tuning: AbilityTuning;
  /** Cast tamamlandığında çalışır. Task 3-5'te gerçek etkiler burada. */
  execute?(ctx: AbilityContext): void;
}

/** Oyun genelindeki olaylar (render, UI, ses ve ileride ağ katmanı dinler). */
export type GameEvents = {
  'element:changed': { casterId: string; element: ElementId };
  'ability:castStart': { casterId: string; ability: AbilityDef };
  'ability:cast': { casterId: string; ability: AbilityDef; origin: Vector3; direction: Vector3; target: Vector3 };
  'ability:cancel': { casterId: string; ability: AbilityDef };
  'ability:denied': { casterId: string; slot: AbilitySlot; reason: 'cooldown' | 'switching' | 'empty' };
};
