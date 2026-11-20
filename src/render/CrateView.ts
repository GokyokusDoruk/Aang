import * as THREE from 'three';
import type { CrateSystem } from '../combat/CrateSystem';

/** Tahta kasa dokusu: kenar çerçevesi + çapraz destek + tahta çizgileri. */
function crateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b07a3e';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(70,40,15,0.45)';
  g.lineWidth = 2;
  for (let y = 16; y < 128; y += 22) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
  }
  g.fillStyle = '#7a4f24';
  g.fillRect(0, 0, 128, 14);
  g.fillRect(0, 114, 128, 14);
  g.fillRect(0, 0, 14, 128);
  g.fillRect(114, 0, 14, 128);
  g.save();
  g.translate(64, 64);
  g.rotate(Math.PI / 4);
  g.fillRect(-82, -8, 164, 16);
  g.restore();
  g.fillStyle = '#3b2a1a';
  for (const [x, y] of [[7, 7], [121, 7], [7, 121], [121, 121]]) {
    g.beginPath();
    g.arc(x, y, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Kırılabilen kasaları çizer; isabette parlar/sarsılır, kırılınca gizlenir (raund başında geri gelir). */
export class CrateView {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly tex = crateTexture();

  constructor(
    scene: THREE.Scene,
    private readonly system: CrateSystem,
  ) {
    for (const c of system.crates) {
      const mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0 });
      const m = new THREE.Mesh(this.geo, mat);
      m.scale.setScalar(c.size);
      m.position.set(c.x, c.y + c.size / 2, c.z);
      m.rotation.y = (c.id % 3) * 0.04 - 0.04;
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      this.meshes.push(m);
      this.mats.push(mat);
    }
  }

  update(): void {
    this.system.crates.forEach((c, i) => {
      const m = this.meshes[i];
      if (!m) return;
      m.visible = c.alive;
      if (!c.alive) return;
      const dmg = 1 - c.hp / c.maxHp;
      this.mats[i].color.setScalar(1 - 0.35 * dmg);
      this.mats[i].emissiveIntensity = c.hitFlash > 0 ? 0.35 : 0;
      const sh = c.hitFlash > 0 ? 0.05 : 0;
      m.position.set(c.x + (Math.random() - 0.5) * sh, c.y + c.size / 2, c.z + (Math.random() - 0.5) * sh);
    });
  }
}
