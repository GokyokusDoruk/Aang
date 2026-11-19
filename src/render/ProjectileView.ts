import * as THREE from 'three';
import { ELEMENTS } from '../abilities/elements';
import type { Projectile, ProjectileSystem } from '../combat/ProjectileSystem';

/** ProjectileSystem durumunu her karede mesh'lerle eşler (interpolasyonlu). */
export class ProjectileView {
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly rockGeo = new THREE.DodecahedronGeometry(1, 0);
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95, flatShading: true });
  private readonly orbGeo = new THREE.SphereGeometry(1, 12, 10);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: ProjectileSystem,
  ) {}

  private create(p: Projectile): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (p.kind === 'rock') {
      mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
      mesh.scale.setScalar(p.spec.radius * 1.25);
    } else {
      const color = ELEMENTS[p.element].color;
      mesh = new THREE.Mesh(this.orbGeo, new THREE.MeshBasicMaterial({ color }));
      mesh.scale.setScalar(p.spec.radius);
    }
    mesh.castShadow = true;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.scene.add(mesh);
    this.meshes.set(p.id, mesh);
    return mesh;
  }

  update(dt: number, alpha: number): void {
    const seen = new Set<number>();
    for (const p of this.system.list) {
      seen.add(p.id);
      const m = this.meshes.get(p.id) ?? this.create(p);
      m.position.lerpVectors(p.prevPosition, p.position, alpha);
      m.rotateOnAxis(p.spin, dt * 14);
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      if (m.material !== this.rockMat) (m.material as THREE.Material).dispose();
      this.meshes.delete(id);
    }
  }
}
