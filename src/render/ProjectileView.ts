import * as THREE from 'three';
import { ELEMENTS } from '../abilities/elements';
import type { Projectile, ProjectileSystem } from '../combat/ProjectileSystem';
import { boulderGeometry } from './rockGeometry';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vfx } from './Vfx';
import { VFX_HDR } from './ParticleField';

/** Buz saçağı: uzun, çok yüzlü sivri ana kristal + köküne yakın iki küçük yan saçak (ucu +Z) */
function icicleGeometry(): THREE.BufferGeometry {
  const main = new THREE.ConeGeometry(1, 7, 6, 1);
  main.rotateX(Math.PI / 2);
  main.translate(0, 0, 0.5);
  const a = new THREE.ConeGeometry(0.45, 2.6, 5, 1);
  a.rotateX(Math.PI / 2 - 0.35);
  a.translate(0.55, 0.15, -1.6);
  const b = new THREE.ConeGeometry(0.4, 2.2, 5, 1);
  b.rotateX(Math.PI / 2 + 0.3);
  b.translate(-0.5, -0.2, -1.9);
  const g = mergeGeometries([main.toNonIndexed(), a.toNonIndexed(), b.toNonIndexed()])!;
  g.computeVertexNormals();
  return g;
}

/** ProjectileSystem durumunu her karede mesh'lerle eşler (interpolasyonlu). */
export class ProjectileView {
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly rockGeos = [1, 2, 3, 4, 5].map((i) => boulderGeometry(i));
  private readonly rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8279, roughness: 0.95, flatShading: true });
  private readonly orbGeo = new THREE.SphereGeometry(1, 12, 10);
  private readonly shardGeo = icicleGeometry();
  private readonly shardMat = new THREE.MeshStandardMaterial({
    color: 0xd4f3ff,
    emissive: 0x4cc4ff,
    emissiveIntensity: 1.0,
    roughness: 0.05,
    metalness: 0.35,
    flatShading: true,
    transparent: true,
    opacity: 0.88,
  });
  private readonly look = new THREE.Vector3();
  /** Sahibin sağ avucu (dünya); Alev Akımı görseli oradan başlar */
  handOf: ((ownerId: string, out: THREE.Vector3) => boolean) | null = null;
  private readonly hand = new THREE.Vector3();
  private readonly fireCore = new THREE.MeshBasicMaterial({ color: 0xffa050 });
  private readonly airCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  private readonly airShell = new THREE.MeshBasicMaterial({
    color: 0xbfe9ff,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly fireShell = new THREE.MeshBasicMaterial({
    color: 0xff2a0a,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: ProjectileSystem,
    private readonly vfx: Vfx | null = null,
  ) {}

  private create(p: Projectile): THREE.Mesh {
    let mesh: THREE.Mesh;
    if (p.kind === 'rock') {
      mesh = new THREE.Mesh(this.rockGeos[p.id % this.rockGeos.length], this.rockMat);
      mesh.scale.setScalar(p.spec.radius * 1.35);
    } else if (p.kind === 'shard') {
      // Uzun buz kıymığı: hız yönüne bakar (lookAt ile +Z ekseni)
      mesh = new THREE.Mesh(this.shardGeo, this.shardMat);
      mesh.scale.set(p.spec.radius * 1.1, p.spec.radius * 1.1, p.spec.radius * 0.85);
      mesh.userData.aligned = true;
    } else if (p.kind === 'fireball') {
      // Kızgın çekirdek; alevler parçacık katmanından (Vfx) gelir
      mesh = new THREE.Mesh(this.orbGeo, this.fireCore);
      mesh.scale.setScalar(p.spec.radius * (this.vfx ? 0.55 : 0.7));
      if (!this.vfx) {
        const shell = new THREE.Mesh(this.orbGeo, this.fireShell);
        shell.scale.setScalar(1.7);
        shell.name = 'shell';
        mesh.add(shell);
      }
      mesh.userData.flicker = true;
    } else if (p.kind === 'airball') {
      // Beyaz çekirdek + dönen, titreyen saydam rüzgar kabuğu
      mesh = new THREE.Mesh(this.orbGeo, this.airCore);
      mesh.scale.setScalar(p.spec.radius * 0.6);
      const shell = new THREE.Mesh(this.orbGeo, this.airShell);
      shell.scale.setScalar(1.9);
      shell.name = 'shell';
      mesh.add(shell);
      mesh.userData.flicker = true;
      mesh.castShadow = false;
    } else if (p.kind === 'flame') {
      // Yaşlandıkça büyüyen, sarıdan kırmızıya dönen, sönen alev topağı (toplamalı)
      mesh = new THREE.Mesh(
        this.orbGeo,
        new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.scale.setScalar(p.spec.radius * 0.5);
      mesh.userData.flame = true;
      mesh.castShadow = false;
      // Görsel avuçtan çıkar: gerçek yolla aradaki fark ilk yarıda sıfıra iner
      if (this.handOf?.(p.ownerId, this.hand)) mesh.userData.handOffset = this.hand.clone().sub(p.position);
    } else {
      const color = ELEMENTS[p.element].color;
      mesh = new THREE.Mesh(this.orbGeo, new THREE.MeshBasicMaterial({ color }));
      mesh.scale.setScalar(p.spec.radius);
    }
    if (!mesh.userData.flame && p.kind !== 'airball') mesh.castShadow = true;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.scene.add(mesh);
    this.meshes.set(p.id, mesh);
    return mesh;
  }

  /** Parçacık izi: ateş topu alevi, alev dili, buz kristali, kaya tozu, rüzgar girdabı */
  private trail(p: Projectile, at: THREE.Vector3, dt: number, m: THREE.Mesh): void {
    const v = this.vfx!;
    switch (p.kind) {
      case 'fireball':
        v.fireballTrail(at, p.velocity, p.spec.radius, dt);
        break;
      case 'flame':
        m.visible = false;
        v.flameTrail(at, p.velocity, p.spec.radius, p.age, p.spec.lifetime, dt, p.id);
        break;
      case 'shard':
        v.icicleTrail(at, p.velocity, dt);
        break;
      case 'rock':
        v.rockTrail(at, p.spec.radius, dt);
        break;
      case 'airball':
        v.airTrail(at, p.velocity, p.spec.radius, p.age, dt);
        break;
    }
  }

  update(dt: number, alpha: number): void {
    // Bloom açıkken ateş topu çekirdeği ve hava topu ışır
    const k = VFX_HDR.value ? 1 : 0;
    this.fireCore.color.setHex(0xffa050).multiplyScalar(1 + 1.6 * k);
    this.airCore.color.setHex(0xffffff).multiplyScalar(1 + 0.4 * k);
    const seen = new Set<number>();
    for (const p of this.system.list) {
      seen.add(p.id);
      const m = this.meshes.get(p.id) ?? this.create(p);
      m.position.lerpVectors(p.prevPosition, p.position, alpha);
      const off = m.userData.handOffset as THREE.Vector3 | undefined;
      if (off) {
        const k = Math.min(1, p.age / (p.spec.lifetime * 0.55));
        m.position.addScaledVector(off, (1 - k) * (1 - k));
      }
      if (this.vfx) this.trail(p, m.position, dt, m);
      if (m.userData.flame) {
        const t = Math.min(1, p.age / p.spec.lifetime);
        m.scale.setScalar(p.spec.radius * (0.5 + t * 1.6) * (0.9 + Math.random() * 0.2));
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.color.setRGB(1, 0.45 - t * 0.37, 0.18 - t * 0.16);
        mat.opacity = 0.85 * (1 - t * t);
      } else if (m.userData.flicker) {
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
      const shared = [this.rockMat, this.shardMat, this.fireCore, this.airCore];
      if (!shared.includes(m.material as never)) (m.material as THREE.Material).dispose();
      this.meshes.delete(id);
    }
  }
}
