export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

/** Kare hızından bağımsız üstel yumuşatma katsayısı (0..1). */
export const damp = (sharpness: number, dt: number): number => 1 - Math.exp(-sharpness * dt);

/** Açıyı (-PI, PI] aralığına sarar. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  a = (a + Math.PI) % twoPi;
  if (a < 0) a += twoPi;
  return a - Math.PI;
}

export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
