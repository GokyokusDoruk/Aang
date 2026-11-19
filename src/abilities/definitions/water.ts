import { GameConfig } from '../../config/gameConfig';
import type { AbilityDef } from '../types';

const T = GameConfig.abilities.tuning;

// Task 2: altyapı + yer tutucu. Gerçek etkiler (execute) Task 4'te.
export const waterAbilities: AbilityDef[] = [
  {
    id: 'waterShard',
    element: 'water',
    slot: 'primary',
    name: 'Buz Kıymığı',
    description: 'Hızlı, hafif buz mermisi.',
    tuning: T.waterShard,
  },
  {
    id: 'iceGlide',
    element: 'water',
    slot: 'secondary',
    name: 'Buz Kayması',
    description: 'Düşük sürtünmeli akıcı süzülme.',
    tuning: T.iceGlide,
  },
];
