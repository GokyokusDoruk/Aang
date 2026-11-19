import { GameConfig } from '../../config/gameConfig';
import type { AbilityDef } from '../types';

const T = GameConfig.abilities.tuning;

// Task 2: altyapı + yer tutucu. Gerçek etkiler (execute) Task 5'te.
export const fireAbilities: AbilityDef[] = [
  {
    id: 'fireBall',
    element: 'fire',
    slot: 'primary',
    name: 'Ateş Topu',
    description: 'Hızlı ateş mermisi.',
    tuning: T.fireBall,
  },
  {
    id: 'lightningLine',
    element: 'fire',
    slot: 'secondary',
    name: 'Yıldırım Hattı',
    description: 'Nişan doğrultusunda ani yıldırım hattı.',
    tuning: T.lightningLine,
  },
];
