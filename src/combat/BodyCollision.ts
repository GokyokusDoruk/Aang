import type { Combatant } from './Combatant';

/**
 * Karakterler birbirinin içinden geçemez: yatayda iç içe giren her çift ayrılır
 * ve birbirine doğru giden hızları kesilir. Dikeyde üst üste değilse (biri diğerinin
 * çok üstündeyse) etkilenmez. Su Küresi içindeki karakter yerinden oynamaz.
 */
export function resolveBodies(list: Combatant[]): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const pa = a.position;
        const pb = b.position;
        // Dikey örtüşme (gövde silindirleri)
        if (pa.y >= pb.y + b.height * 0.9 || pb.y >= pa.y + a.height * 0.9) continue;
        let dx = pb.x - pa.x;
        let dz = pb.z - pa.z;
        const min = a.radius + b.radius;
        let d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 1e-4) {
          // Tam üst üste: rastgele değil, sabit bir yöne ayır
          dx = 1;
          dz = 0;
          d = 1;
        }
        const nx = dx / d;
        const nz = dz / d;
        const overlap = min - Math.min(d, min);
        // Sabit duranlar (Su Küresi) itilmez
        const wa = a.sphereTimer > 0 ? 0 : 1;
        const wb = b.sphereTimer > 0 ? 0 : 1;
        const sum = wa + wb;
        if (sum === 0) continue;
        const ma = (overlap * wa) / sum;
        const mb = (overlap * wb) / sum;
        if (ma > 0) a.controller.nudge(-nx * ma, -nz * ma, -nx, -nz);
        if (mb > 0) b.controller.nudge(nx * mb, nz * mb, nx, nz);
      }
    }
  }
}
