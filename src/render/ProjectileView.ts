import * as THREE from 'three';
import { ELEMENTS } from '../abilities/elements';
import type { Projectile, ProjectileSystem } from '../combat/ProjectileSystem';

/** ProjectileSystem durumunu her karede mesh'lerle eşler (interpolasyonlu). */
export class ProjectileView {
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly rockGeo = new THREE.DodecahedronGeometry(1, 0);
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95, flatShading: true });
  private readonly orbGeo = new THREE.SphereGeometry(1, 12, 10);
  private readonly shardGeo = new THREE.OctahedronGeometry(1, 0);
  private readonly shardMat = new THREE.MeshStandardMaterial({
    color: 0xbfefff,
    emissive: 0x2a9fd6,
    emissiveIntensity: 0.6,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });
  private readonly look = new THREE.Vector3();
  private readonly fireCore = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  private readonly fireShell = new THREE.MeshBasicMaterial({
    color: 0xff6b1a,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: ProjectileSystem,
  ) {}

  private create(p: Projectile): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (p.kind === 'rock') {
      mesh = new THREE.Mesh(this.rockGeo, this.rockMat);
      mesh.scale.setScalar(p.spec.radius * 1.25);
    } else if (p.kind === 'shard') {
      // Uzun buz kıymığı: hız yönüne bakar (lookAt ile +Z ekseni)
      mesh = new THREE.Mesh(this.shardGeo, this.shardMat);
      mesh.scale.set(p.spec.radius, p.spec.radius, p.spec.radius * 3.2);
      mesh.userData.aligned = true;
    } else if (p.kind === 'fireball') {
      // Sarı çekirdek + titreyen turuncu kabuk (toplamalı karışım: ışık gibi parlar)
      mesh = new THREE.Mesh(this.orbGeo, this.fireCore);
      mesh.scale.setScalar(p.spec.radius * 0.7);
      const shell = new THREE.Mesh(this.orbGeo, this.fireShell);
      shell.scale.setScalar(1.7);
      shell.name = 'shell';
      mesh.add(shell);
      mesh.userData.flicker = true;
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
      if (m.userData.flicker) {
        const shell = m.getObjectByName('shell');
        if (shell) shell.scale.setScalar(1.55 + Math.random() * 0.4);
      } else if (m.userData.aligned) {
        m.lookAt(this.look.copy(m.position).add(p.velocity));
        m.rotateZ(p.age * 20);
      } else {
        m.rotateOnAxis(p.spin, dt * 14);
      }
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      const shared = [this.rockMat, this.shardMat, this.fireCore];
      if (!shared.includes(m.material as never)) (m.material as THREE.Material).dispose();
      this.meshes.delete(id);
    }
  }
}
