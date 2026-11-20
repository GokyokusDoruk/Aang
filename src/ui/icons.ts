import type { ElementId } from '../abilities/elements';

/** Yetenek ve element ikonları: 24x24 satır içi SVG (dış varlık gerekmez). */
const F = (d: string) => `<path d="${d}" fill="currentColor"/>`;
const S = (d: string, w = 2) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const ROCK = F('M4 18 L7 9 L13 5 L19 9 L20 17 L13 20 Z');
const DROP = F('M12 3 C15 8 18 11 18 14.5 A6 6 0 0 1 6 14.5 C6 11 9 8 12 3 Z');
const FLAME = F('M12 2 C13 6 18 9 18 14.5 A6 6 0 0 1 6 14.5 C6 11.5 8 10 9 8 C9.5 10 10.5 11 11.5 11 C11 8 11 5 12 2 Z');
const SWIRL = S('M3 9 H14 A3 3 0 1 0 11 6 M3 14 H18 A3 3 0 1 1 15 17 M5 19 H11');

const ABILITY: Record<string, string> = {
  earthRock: ROCK + F('M5 6 l1.5-1.5 M3 10 l1-1'),
  earthWall: F('M2 21 L6 9 L9 21 Z M8 21 L12.5 3 L17 21 Z M15 21 L18.5 10 L22 21 Z'),
  waterShard: F('M12 2 L17 12 L12 22 L7 12 Z') + S('M12 6 V18', 1),
  iceWall: F('M3 21 L5 8 L8 5 L9 21 Z M10 21 L11 4 L13.5 2 L15 21 Z M16 21 L17 7 L20 9 L21 21 Z') + S('M5.5 12 L7 10.5 M12 9 L13 7.5 M17.5 13 L19 11.5', 1),
  iceGlide: S('M12 3 V21 M4.2 7.5 L19.8 16.5 M4.2 16.5 L19.8 7.5 M9.5 4.5 L12 7 L14.5 4.5 M9.5 19.5 L12 17 L14.5 19.5'),
  fireBall: FLAME,
  lightningLine: F('M14 2 L5 13.5 H11 L9.5 22 L19 9.5 H13 Z'),
  airShockwave: F('M12 10 A2 2 0 1 1 12 14 A2 2 0 1 1 12 10 Z') + S('M7.5 7.5 A6.4 6.4 0 0 0 7.5 16.5 M16.5 7.5 A6.4 6.4 0 0 1 16.5 16.5 M4.5 4.5 A10.6 10.6 0 0 0 4.5 19.5 M19.5 4.5 A10.6 10.6 0 0 1 19.5 19.5'),
  airLeap: S('M6 12 L12 6 L18 12 M6 19 L12 13 L18 19', 2.4),
};

const ELEMENT: Record<ElementId, string> = { earth: ROCK, water: DROP, fire: FLAME, air: SWIRL };

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export function abilityIcon(id: string | undefined, element: ElementId): string {
  return svg((id && ABILITY[id]) || ELEMENT[element]);
}

export function elementIcon(id: ElementId): string {
  return svg(ELEMENT[id]);
}
