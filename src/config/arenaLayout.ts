/**
 * Arena yerleşimi SAF VERİ olarak tanımlanır.
 * - Fizik (CollisionWorld) ve render (ArenaView) aynı veriden üretilir.
 * - Yeni arena = yeni bir ArenaLayout nesnesi.
 */
export type BoxKind = 'floor' | 'wall' | 'cover' | 'platform' | 'step' | 'pillar';

export interface BoxDef {
  kind: BoxKind;
  /** Merkez X/Z */
  x: number;
  z: number;
  /** Taban yüksekliği (varsayılan 0) */
  y?: number;
  w: number; // X boyutu
  h: number; // Y boyutu
  d: number; // Z boyutu
}

/** Rampanın yükseldiği yön. */
export type RampDir = '+x' | '-x' | '+z' | '-z';

export interface RampDef {
  x: number;
  z: number;
  y?: number;
  /** Yönün dik eksenindeki genişlik */
  w: number;
  /** Yön boyunca uzunluk */
  l: number;
  /** Tepe yüksekliği */
  h: number;
  dir: RampDir;
}

/** Kırılabilen kasa: tabanı y'de, kenar uzunluğu size (varsayılan 1.2). */
export interface CrateDef {
  x: number;
  z: number;
  y?: number;
  size?: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ArenaLayout {
  size: number;
  boxes: BoxDef[];
  ramps: RampDef[];
  crates: CrateDef[];
  spawnPoints: SpawnPoint[];
  /** Test kuklaları (Task 6'da botlarla değişecek) */
  dummySpawns: SpawnPoint[];
}

const SIZE = 44;
const HALF = SIZE / 2;

function stairs(side: 1 | -1): BoxDef[] {
  // Merkez platformun ±X kenarına (x=±4) çıkan 5 basamak (0.4m adım).
  const out: BoxDef[] = [];
  for (let i = 0; i < 5; i++) {
    out.push({ kind: 'step', x: side * (4 + (4 - i) * 0.8 + 0.4), z: 0, w: 0.8, h: 0.4 * (i + 1), d: 3 });
  }
  return out;
}

function cornerCover(sx: 1 | -1, sz: 1 | -1): BoxDef[] {
  return [
    { kind: 'cover', x: sx * 10, z: sz * 9, w: 4, h: 1.6, d: 1 },
    { kind: 'cover', x: sx * 11.5, z: sz * 10.5, w: 1, h: 1.6, d: 2 },
  ];
}

function boundaryWalls(): BoxDef[] {
  // Kenarların ortasında 12m açıklık bırakılır (ileride itilip düşme / ring-out için).
  const t = 0.6;
  const e = HALF - t / 2;
  const seg = 16;
  const c = 14;
  return [
    { kind: 'wall', x: -c, z: -e, w: seg, h: 1, d: t },
    { kind: 'wall', x: c, z: -e, w: seg, h: 1, d: t },
    { kind: 'wall', x: -c, z: e, w: seg, h: 1, d: t },
    { kind: 'wall', x: c, z: e, w: seg, h: 1, d: t },
    { kind: 'wall', x: -e, z: -c, w: t, h: 1, d: seg },
    { kind: 'wall', x: -e, z: c, w: t, h: 1, d: seg },
    { kind: 'wall', x: e, z: -c, w: t, h: 1, d: seg },
    { kind: 'wall', x: e, z: c, w: t, h: 1, d: seg },
  ];
}

export const DefaultArena: ArenaLayout = {
  size: SIZE,
  boxes: [
    { kind: 'floor', x: 0, z: 0, y: -1, w: SIZE, h: 1, d: SIZE },

    // Merkez yükselti + basamaklar
    { kind: 'platform', x: 0, z: 0, w: 8, h: 2, d: 8 },
    ...stairs(1),
    ...stairs(-1),

    // Yan yükseltiler (rampayla çıkılır)
    { kind: 'platform', x: 17, z: 0, w: 4, h: 1.2, d: 6 },
    { kind: 'platform', x: -17, z: 0, w: 4, h: 1.2, d: 6 },

    // Siperler
    ...cornerCover(1, 1),
    ...cornerCover(1, -1),
    ...cornerCover(-1, 1),
    ...cornerCover(-1, -1),
    { kind: 'cover', x: 0, z: 13, w: 5, h: 1.2, d: 1 },
    { kind: 'cover', x: 0, z: -13, w: 5, h: 1.2, d: 1 },
    { kind: 'cover', x: 14, z: 6, w: 1, h: 2.2, d: 3 },
    { kind: 'cover', x: -14, z: -6, w: 1, h: 2.2, d: 3 },
    { kind: 'cover', x: 14, z: -6, w: 1, h: 2.2, d: 3 },
    { kind: 'cover', x: -14, z: 6, w: 1, h: 2.2, d: 3 },

    // Yüksek sütunlar
    { kind: 'pillar', x: 16, z: 16, w: 2, h: 6, d: 2 },
    { kind: 'pillar', x: -16, z: 16, w: 2, h: 6, d: 2 },
    { kind: 'pillar', x: 16, z: -16, w: 2, h: 6, d: 2 },
    { kind: 'pillar', x: -16, z: -16, w: 2, h: 6, d: 2 },

    ...boundaryWalls(),
  ],
  ramps: [
    { x: 0, z: 7, w: 3, l: 6, h: 2, dir: '-z' },
    { x: 0, z: -7, w: 3, l: 6, h: 2, dir: '+z' },
    { x: 12.5, z: 0, w: 3, l: 5, h: 1.2, dir: '+x' },
    { x: -12.5, z: 0, w: 3, l: 5, h: 1.2, dir: '-x' },
  ],
  crates: [
    { x: -6, z: 4 },
    { x: -6, z: 4, y: 1.2 },
    { x: -7.3, z: 4.3 },
    { x: 6, z: -4 },
    { x: 6, z: -4, y: 1.2 },
    { x: 7.3, z: -4.3 },
    { x: 9, z: 3.5 },
    { x: -9, z: -3.5 },
    { x: 3.5, z: 17 },
    { x: -3.5, z: -17 },
    { x: 18.5, z: 9 },
    { x: -18.5, z: -9 },
    { x: 18.5, z: 9, y: 1.2, size: 1 },
  ],
  spawnPoints: [
    // Çaprazlama doğuş: arkada sınır duvarı var (kenar boşluklarının önünde değil)
    { x: -8, y: 0, z: 15, yaw: -0.49 },
    { x: 8, y: 0, z: -15, yaw: Math.PI - 0.49 },
  ],
  dummySpawns: [
    { x: 0, y: 2, z: -1, yaw: 0 },
    { x: -7, y: 0, z: 6, yaw: 0 },
    { x: 7, y: 0, z: 6, yaw: 0 },
    { x: 17, y: 1.2, z: 0, yaw: Math.PI / 2 },
  ],
};
