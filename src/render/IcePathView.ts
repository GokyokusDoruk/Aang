import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import type { IcePathSystem, IceSegment } from '../combat/IcePathSystem';

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
  /** Erimekte olan plakalar için (saydamlık kendi malzemesinde) */
  private readonly melting = new Map<number, THREE.MeshStandardMaterial>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: IcePathSystem,
  ) {}

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

  update(): void {
    const P = GameConfig.water.icePath;
    const seen = new Set<number>();
    for (const s of this.system.list) {
      seen.add(s.id);
      const m = this.meshes.get(s.id) ?? this.create(s);
      const left = s.life - s.age;
      const grow = Math.min(1, s.age / 0.12);
      const melt = left < P.meltTime ? left / P.meltTime : 1;
      const t = P.thickness * grow * (0.35 + 0.65 * melt);
      m.scale.set(s.width * (0.6 + 0.4 * grow), t, s.length);
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
