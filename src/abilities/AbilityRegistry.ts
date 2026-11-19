import type { ElementId } from './elements';
import type { AbilityDef, AbilitySlot } from './types';
import { earthAbilities } from './definitions/earth';
import { waterAbilities } from './definitions/water';
import { fireAbilities } from './definitions/fire';
import { airAbilities } from './definitions/air';

/** Element + slot → yetenek eşlemesi. */
export class AbilityRegistry {
  private readonly table = new Map<ElementId, Partial<Record<AbilitySlot, AbilityDef>>>();
  private readonly byId = new Map<string, AbilityDef>();

  register(def: AbilityDef): void {
    if (this.byId.has(def.id)) throw new Error(`Yetenek zaten kayıtlı: ${def.id}`);
    let row = this.table.get(def.element);
    if (!row) {
      row = {};
      this.table.set(def.element, row);
    }
    row[def.slot] = def;
    this.byId.set(def.id, def);
  }

  get(element: ElementId, slot: AbilitySlot): AbilityDef | undefined {
    return this.table.get(element)?.[slot];
  }

  byIdOf(id: string): AbilityDef | undefined {
    return this.byId.get(id);
  }

  all(): AbilityDef[] {
    return [...this.byId.values()];
  }
}

export function createDefaultRegistry(): AbilityRegistry {
  const r = new AbilityRegistry();
  for (const def of [...earthAbilities, ...waterAbilities, ...fireAbilities, ...airAbilities]) r.register(def);
  return r;
}
