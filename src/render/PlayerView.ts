import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';

/** Oyuncunun görsel temsili (kapsül + yön göstergesi). Mantıktan yalnızca durum okur. */
export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly visor: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly visorMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, color = 0x3fa7ff) {
    const P = GameConfig.player;
    this.bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: 0x000000 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x1b1f2a, roughness: 0.3 });

    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(P.radius, P.height - P.radius * 2, 6, 14), this.bodyMat);
    this.body.castShadow = true;
    this.root.add(this.body);

    this.visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.2), this.visorMat);
    this.visor.castShadow = true;
    this.root.add(this.visor);

    scene.add(this.root);
  }

  update(
    position: THREE.Vector3,
    yaw: number,
    heightRatio: number,
    dashing: boolean,
    cameraDistance: number,
    elementColor = 0x1b1f2a,
    castProgress = 0,
  ): void {
    const P = GameConfig.player;
    const h = P.height * heightRatio;
    this.root.position.copy(position);
    this.root.rotation.y = yaw;
    this.body.scale.y = heightRatio;
    this.body.position.y = h / 2;
    this.visor.position.set(0, h * 0.82, -P.radius * 0.9);

    // Visör aktif elementin rengini taşır; hazırlık (cast) sırasında gövde element rengiyle parlar
    this.visorMat.emissive.setHex(elementColor);
    this.visorMat.emissiveIntensity = 0.8;
    if (dashing) {
      this.bodyMat.emissive.setHex(0x66ccff);
      this.bodyMat.emissiveIntensity = 0.9;
    } else if (castProgress > 0) {
      this.bodyMat.emissive.setHex(elementColor);
      this.bodyMat.emissiveIntensity = 0.25 + 0.6 * castProgress;
    } else {
      this.bodyMat.emissiveIntensity = 0;
    }

    // Kamera duvar yüzünden çok yaklaşırsa karakteri saydamlaştır
    const opacity = Math.min(1, Math.max(0.15, (cameraDistance - 0.6) / 1.2));
    const transparent = opacity < 0.999;
    for (const m of [this.bodyMat, this.visorMat]) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
    }
  }
}
