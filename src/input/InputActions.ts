/**
 * Cihazdan bağımsız aksiyon şeması.
 * Oyun mantığı yalnızca bu soyut aksiyonları görür; klavye, fare, dokunmatik
 * (ve ileride gamepad / native Capacitor input) bunları üreten "kaynak"lardır.
 */
export const ACTIONS = [
  'jump',
  'dash',
  'slide',
  'primary', // Task 2+: ana saldırı / yetenek kullan
  'secondary', // Task 2+: ikincil yetenek
  'element1', // Task 2: Toprak
  'element2', // Task 2: Su/Buz
  'element3', // Task 2: Ateş/Yıldırım
  'element4', // Task 2: Hava
  'reset', // test: yeniden doğ
] as const;

export type Action = (typeof ACTIONS)[number];

export type ActionFlags = Record<Action, boolean>;

/** Input kaynaklarının olay ilettiği hedef (InputManager). */
export interface InputSink {
  press(action: Action): void;
  release(action: Action): void;
  /** Radyan cinsinden bakış deltası (kaynak kendi hassasiyetini uygular). */
  look(dx: number, dy: number): void;
}

export interface InputSource {
  /** -1..1 ; y>0 ileri */
  readonly move: { x: number; y: number };
  dispose(): void;
}

/** Bir fizik adımının tükettiği input anlık görüntüsü. */
export interface StepInput {
  moveX: number;
  moveY: number;
  held: ActionFlags;
  /** Son adımdan beri basılanlar (kenar tetik). */
  pressed: ActionFlags;
}

export function emptyFlags(): ActionFlags {
  const f = {} as ActionFlags;
  for (const a of ACTIONS) f[a] = false;
  return f;
}
