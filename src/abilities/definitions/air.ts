import { GameConfig } from '../../config/gameConfig';
import type { AbilityDef } from '../types';

const T = GameConfig.abilities.tuning;

// Task 2: altyapı + yer tutucu. Gerçek etkiler (execute) Task 4'te.
export const airAbilities: AbilityDef[] = [
  {
    id: 'airShockwave',
    element: 'air',
    slot: 'primary',
    name: 'Şok Dalgası',
    description: 'Rakipleri ve mermileri iten rüzgar dalgası.',
    tuning: T.airShockwave,
  },
  {
    id: 'airLeap',
    element: 'air',
    slot: 'secondary',
    name: 'Rüzgar Sıçrayışı',
    description: 'Yukarı / ileri fırlatma.',
    tuning: T.airLeap,
  },
];
