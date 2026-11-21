import type { Vector3 } from 'three';
import type { ElementId } from '../abilities/elements';
import type { AbilityDef, AbilitySlot, ChargedAbility } from '../abilities/types';

/** Oyun genelindeki olaylar. Mantık yayar; render, UI, ses (ve ileride ağ) dinler. */
export type GameEvents = {
  'element:changed': { casterId: string; element: ElementId };
  'ability:castStart': { casterId: string; ability: AbilityDef };
  'ability:cast': { casterId: string; ability: AbilityDef; origin: Vector3; direction: Vector3; target: Vector3 };
  'ability:cancel': { casterId: string; ability: AbilityDef };
  /** Uzun basış başladı (kanal / şarj) */
  'ability:chargedStart': { casterId: string; ability: AbilityDef; charged: ChargedAbility };
  /** Uzun basış bitti: charge = şarj oranı (kanal için 1), cancelled = dash/element değişimiyle kesildi */
  'ability:chargedEnd': { casterId: string; ability: AbilityDef; charged: ChargedAbility; charge: number; cancelled: boolean; origin: Vector3 };
  'ability:denied': { casterId: string; slot: AbilitySlot; reason: 'cooldown' | 'switching' | 'empty' | 'invalid' };

  /** kind: 'burn' = yanma hasarı (sürekli, küçük), 'self' = kendi patlaman */
  'combat:damage': { targetId: string; sourceId: string; amount: number; point: Vector3; killed: boolean; kind?: 'burn' | 'self' };
  /** Hedef tutuştu (ya da yanması yenilendi) */
  'combat:burn': { targetId: string; sourceId: string; point: Vector3 };
  /** Üşüme tam yığına ulaştı: hedef kısa süre donar. */
  'combat:frozen': { targetId: string; duration: number; point: Vector3 };
  'combat:death': { targetId: string; cause: 'hp' | 'ringout'; killerId: string | null };
  'combat:respawn': { targetId: string };
  'combat:ringout': { targetId: string };

  'projectile:impact': { kind: string; element: ElementId; point: Vector3; normal: Vector3 | null; hitCombatant: boolean };

  'wall:spawn': { wallId: number; ownerId: string; element: ElementId };
  'wall:hit': { wallId: number; point: Vector3; amount: number };
  'wall:destroyed': { wallId: number; columns: Vector3[]; element: ElementId };

  'crate:hit': { crateId: number; point: Vector3 };
  'crate:broken': { crateId: number; center: Vector3; size: number };

  'fx:explosion': { point: Vector3; radius: number; element: ElementId };
  'fx:lightning': { from: Vector3; to: Vector3; element: ElementId };
  'fx:shockwave': { origin: Vector3; direction: Vector3; range: number; halfAngle: number; element: ElementId };
  'projectile:deflect': { ownerId: string; count: number };

  'round:phase': {
    phase: 'idle' | 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';
    round: number;
    scores: Record<string, number>;
    winnerId: string | null;
    reason: 'hp' | 'ringout' | 'time' | null;
  };

  /** Genel görsel patlama (toz, parça) */
  'fx:burst': { point: Vector3; element: ElementId; size: number };
};
