import type { Vector3 } from 'three';
import type { ElementId } from '../abilities/elements';
import type { AbilityDef, AbilitySlot } from '../abilities/types';

/** Oyun genelindeki olaylar. Mantık yayar; render, UI, ses (ve ileride ağ) dinler. */
export type GameEvents = {
  'element:changed': { casterId: string; element: ElementId };
  'ability:castStart': { casterId: string; ability: AbilityDef };
  'ability:cast': { casterId: string; ability: AbilityDef; origin: Vector3; direction: Vector3; target: Vector3 };
  'ability:cancel': { casterId: string; ability: AbilityDef };
  'ability:denied': { casterId: string; slot: AbilitySlot; reason: 'cooldown' | 'switching' | 'empty' | 'invalid' };

  'combat:damage': { targetId: string; sourceId: string; amount: number; point: Vector3; killed: boolean };
  'combat:death': { targetId: string };
  'combat:respawn': { targetId: string };
  'combat:ringout': { targetId: string };

  'projectile:impact': { kind: string; element: ElementId; point: Vector3; normal: Vector3 | null; hitCombatant: boolean };

  'wall:spawn': { wallId: number; ownerId: string };
  'wall:hit': { wallId: number; point: Vector3; amount: number };
  'wall:destroyed': { wallId: number; columns: Vector3[]; element: ElementId };

  /** Genel görsel patlama (toz, parça) */
  'fx:burst': { point: Vector3; element: ElementId; size: number };
};
