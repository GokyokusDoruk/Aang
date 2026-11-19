/**
 * Element kataloğu (içerik verisi). Yeni element eklemek için:
 *  1) ELEMENT_ORDER'a id ekle  2) ELEMENTS'a meta ekle
 *  3) abilities/definitions/ altına yetenek dosyası ekle  4) gameConfig.abilities.tuning'e ayar ekle
 */
export const ELEMENT_ORDER = ['earth', 'water', 'fire', 'air'] as const;

export type ElementId = (typeof ELEMENT_ORDER)[number];

export interface ElementMeta {
  name: string;
  short: string;
  color: number;
  css: string;
}

export const ELEMENTS: Record<ElementId, ElementMeta> = {
  earth: { name: 'Toprak', short: 'Toprak', color: 0xc08a4a, css: '#c08a4a' },
  water: { name: 'Su / Buz', short: 'Su', color: 0x4fc3f7, css: '#4fc3f7' },
  fire: { name: 'Ateş / Yıldırım', short: 'Ateş', color: 0xff6b3d, css: '#ff6b3d' },
  air: { name: 'Hava', short: 'Hava', color: 0xc9f3e4, css: '#c9f3e4' },
};
