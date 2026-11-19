import { GameConfig } from '../../config/gameConfig';
import type { AbilityDef } from '../types';

const T = GameConfig.abilities.tuning;

// Task 2: altyapı + yer tutucu. Gerçek etkiler (execute) Task 3'te.
export const earthAbilities: AbilityDef[] = [
  {
    id: 'earthRock',
    element: 'earth',
    slot: 'primary',
    name: 'Kaya Fırlatma',
    description: 'Yerden kopardığın kayayı nişan noktasına fırlat.',
    tuning: T.earthRock,
  },
  {
    id: 'earthWall',
    element: 'earth',
    slot: 'secondary',
    name: 'Toprak Duvar',
    description: 'Nişan bölgesinde yerden siper duvarı yükselt.',
    tuning: T.earthWall,
  },
];
