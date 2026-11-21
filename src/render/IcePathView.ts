import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import type { IcePathSystem, IceSegment } from '../combat/IcePathSystem';

/** Yumuşak kenarlı yuvarlak kar tanesi dokusu */
function flakeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(240,250,255,0.9)');
  grad.addColorStop(1, 'rgba(220,240,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Buz yolu plakalarını yarı saydam, eğimli buz levhaları olarak çizer; ömrünün sonunda erir (incelir, batar, solar). */
export class IcePathView {
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);
  private readonly iceMat = new THREE.MeshStandardMaterial({
    color: 0xc4ecff,
    emissive: 0x5cc8ff,
    emissiveIntensity: 0.22,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.78,
  });
  private readonly snowMat = new THREE.MeshStandardMaterial({
    color: 0xf4fbff,
    emissive: 0x9fdcff,
    emissiveIntensity: 0.18,
    roughness: 0.9,
    transparent: true,
    opacity: 0.92,
  });
  /** Kar yağışı: kar izi plakalarının üstünden yağan taneler (havuzlu parçacıklar) */
  private readonly flakeMax = 10000;
  private readonly flakePos = new Float32Array(this.flakeMax * 3);
  private readonly flakeVel = new Float32Array(this.flakeMax * 3);
  private readonly flakeFloor = new Float32Array(this.flakeMax).fill(-1e9);
  private readonly flakes: THREE.Points;
  private flakeNext = 0;
  private emitAcc = 0;
  /** Erimekte olan plakalar için (saydamlık kendi malzemesinde) */
  private readonly melting = new Map<number, THREE.MeshStandardMaterial>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: IcePathSystem,
  ) {
    const g = new THREE.BufferGeometry();
    this.flakePos.fill(-1e4);
    g.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3));
    this.flakes = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, map: flakeTexture(), transparent: true, opacity: 0.95, depthWrite: false, sizeAttenuation: true }),
    );
    this.flakes.frustumCulled = false;
    scene.add(this.flakes);
  }

  /** Kar izi plakalarının üstünde, 2-3 m yukarıdan yağan kar taneleri. */
  private updateSnow(dt: number): void {
    const P = GameConfig.water.icePath;
    const snow = this.system.list.filter((s) => s.snow && s.age < s.life - P.meltTime * 0.5);
    this.emitAcc += dt * P.snowfallRate * snow.length;
    while (this.emitAcc >= 1 && snow.length > 0) {
      this.emitAcc -= 1;
      const s = snow[(Math.random() * snow.length) | 0];
      const i = this.flakeNext;
      this.flakeNext = (this.flakeNext + 1) % this.flakeMax;
      const r = P.snowRadius;
      const x = s.x + (Math.random() - 0.5) * 2 * r;
      const z = s.z + (Math.random() - 0.5) * 2 * r;
      // Yolun altından yere doğru yağar; altı boşsa (yerdeyse) plakanın etrafında savrulur
      const ground = this.system.groundBelow(x, z, s.y - 0.35);
      const gap = s.y - ground;
      const under = gap > 0.8;
      this.flakePos[i * 3] = x;
      this.flakePos[i * 3 + 1] = under ? s.y - P.thickness - Math.random() * 0.3 : s.y + Math.random() * 1.6;
      this.flakePos[i * 3 + 2] = z;
      // Fırtına: güçlü, girdaplı yatay savrulma
      const a = Math.random() * Math.PI * 2;
      const w = 1 + Math.random() * 2.5;
      this.flakeVel[i * 3] = Math.cos(a) * w;
      this.flakeVel[i * 3 + 1] = under ? -(2.5 + Math.random() * 3) : -(0.6 + Math.random() * 1.2);
      this.flakeVel[i * 3 + 2] = Math.sin(a) * w;
      this.flakeFloor[i] = under ? ground : s.y - 0.2;
    }
    if (snow.length === 0) this.emitAcc = 0;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.flakeMax; i++) {
      const y = this.flakePos[i * 3 + 1];
      if (y < -1e3) continue;
      // Girdap: tane sallanarak ve savrularak düşer
      const sw = 1.6;
      this.flakePos[i * 3] += (this.flakeVel[i * 3] + Math.sin(t * 4 + i * 1.7) * sw) * dt;
      this.flakePos[i * 3 + 1] = y + this.flakeVel[i * 3 + 1] * dt;
      this.flakePos[i * 3 + 2] += (this.flakeVel[i * 3 + 2] + Math.cos(t * 3.4 + i * 1.3) * sw) * dt;
      if (this.flakePos[i * 3 + 1] < this.flakeFloor[i]) this.flakePos[i * 3 + 1] = -1e4;
    }
    (this.flakes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private create(s: IceSegment): THREE.Mesh {
    const m = new THREE.Mesh(this.geo, s.snow ? this.snowMat : this.iceMat);
    m.rotation.order = 'YXZ';
    m.rotation.y = s.yaw;
    m.rotation.x = -s.pitch;
    m.receiveShadow = true;
    m.castShadow = false;
    this.scene.add(m);
    this.meshes.set(s.id, m);
    return m;
  }

  update(dt = 1 / 60): void {
    const P = GameConfig.water.icePath;
    this.updateSnow(dt);
    const seen = new Set<number>();
    for (const s of this.system.list) {
      seen.add(s.id);
      const m = this.meshes.get(s.id) ?? this.create(s);
      const left = s.life - s.age;
      const grow = Math.min(1, s.age / 0.12);
      const melt = left < P.meltTime ? left / P.meltTime : 1;
      const t = P.thickness * grow * (0.35 + 0.65 * melt);
      const fluff = s.snow ? 1.35 : 1;
      m.scale.set(s.width * fluff * (0.6 + 0.4 * grow), t * (s.snow ? 1.6 : 1), s.length);
      m.position.set(s.x, s.y - t / 2 - (1 - melt) * 0.25, s.z);
      if (melt < 1) {
        let mat = this.melting.get(s.id);
        if (!mat) {
          mat = (m.material as THREE.MeshStandardMaterial).clone();
          this.melting.set(s.id, mat);
          m.material = mat;
        }
        mat.opacity = (s.snow ? 0.92 : 0.78) * melt;
      }
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.melting.get(id)?.dispose();
      this.melting.delete(id);
      this.meshes.delete(id);
    }
  }
}
