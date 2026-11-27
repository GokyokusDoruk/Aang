import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';

/**
 * Görsel gövde payı: çarpışma silindiri (0.4 m) yürüme için dar tutulur, ama animasyonda kollar
 * (yumruk, savaş duruşu, büyü hamleleri) ve geniş adımlar bunun dışına taşar ve duvar / kasa içine girer.
 * Bu sınıf yalnızca ÇİZİLEN modeli yakın engellerden hafifçe uzaklaştırır; oyun mantığına dokunmaz.
 *
 * Yöne bağlı yarıçap (karakter ekseninde): önde kollar için geniş, yanlarda orta, arkada dar.
 */
const FRONT = 0.72;
/** Büyü hamlesinde (yumruk / itme) kol daha da öne uzanır */
const FRONT_REACH = 1.0;
const SIDE = 0.56;
const BACK = 0.42;
/** Ayaklardan bu kadar yukarısı engel sayılır (basamak / üstünde durulan zemin hariç) */
const STEP = 0.35;
/** Modelin gerçek konumdan en fazla ne kadar kayabileceği (ayak kayması göze batmasın) */
const MAX_SHIFT = 0.6;

export class BodyClearance {
  private readonly offset = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private init = false;
  /** 0..1: hamle payının yumuşak geçişi */
  private reach = 0;

  constructor(private readonly world: CollisionWorld) {}

  /** Yeniden doğma / ışınlanma: kaymayı sıfırla */
  reset(): void {
    this.init = false;
    this.offset.set(0, 0, 0);
  }

  /**
   * pos: mantıktaki ayak konumu, yaw: bakış, height: o anki boy (eğilince kısalır).
   * out: modelin çizileceği konum (pos + yumuşatılmış itme).
   */
  apply(pos: THREE.Vector3, yaw: number, height: number, dt: number, out: THREE.Vector3, reaching = false): THREE.Vector3 {
    // Hamle başlar başlamaz pay tam açılır (ilk karede bile kol duvara girmesin), bitince yavaşça kapanır
    this.reach = reaching ? 1 : this.reach * Math.exp(-6 * dt);
    const front = FRONT + (FRONT_REACH - FRONT) * this.reach;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let cx = pos.x;
    let cz = pos.z;
    const feet = pos.y + STEP;
    const head = pos.y + Math.max(0.9, height);
    // İki geçiş: köşelerde iki duvardan birden itilebilsin
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.world.boxes) {
        if (b.maxY <= feet || b.minY >= head) continue;
        const px = cx < b.minX ? b.minX : cx > b.maxX ? b.maxX : cx;
        const pz = cz < b.minZ ? b.minZ : cz > b.maxZ ? b.maxZ : cz;
        const dx = cx - px;
        const dz = cz - pz;
        const d2 = dx * dx + dz * dz;
        // Merkez kutunun içindeyse (üstünden geçiş vb.) mantığa bırak
        if (d2 < 1e-8 || d2 > front * front) continue;
        const d = Math.sqrt(d2);
        // Engele doğru yön, karakterin ilerisiyle hizası → o yöndeki gövde yarıçapı
        const f = -(dx * fx + dz * fz) / d;
        const r = f >= 0 ? SIDE + (front - SIDE) * f : SIDE + (BACK - SIDE) * -f;
        if (d >= r) continue;
        const push = r - d;
        cx += (dx / d) * push;
        cz += (dz / d) * push;
      }
    }
    this.target.set(cx - pos.x, 0, cz - pos.z);
    if (this.target.lengthSq() > MAX_SHIFT * MAX_SHIFT) this.target.setLength(MAX_SHIFT);
    // İtme yaklaşırken hızlı, uzaklaşırken yumuşak (titreme / ani sıçrama olmasın)
    if (!this.init) {
      this.offset.copy(this.target);
      this.init = true;
    } else {
      // Engele yaklaşırken anında (kol hiç girmesin), uzaklaşırken yumuşak geri dönüş
      if (this.target.lengthSq() > this.offset.lengthSq()) this.offset.copy(this.target);
      else this.offset.lerp(this.target, 1 - Math.exp(-8 * dt));
    }
    return out.copy(pos).add(this.offset);
  }
}
