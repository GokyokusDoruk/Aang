import * as THREE from 'three';
import type { Combatant } from '../combat/Combatant';

interface Swirl {
  group: THREE.Group;
  bands: THREE.Mesh[];
  drops: THREE.Mesh[];
  mat: THREE.MeshStandardMaterial;
  dropMat: THREE.MeshBasicMaterial;
  fade: number;
}

/**
 * Şifa Suyu: karakterin etrafında farklı yükseklik ve eğimlerde dönen su şeritleri
 * ve yörüngede damlalar. Etki bitince şeritler aşağı süzülüp söner.
 */
export class HealView {
  private readonly swirls = new Map<string, Swirl>();
  private readonly band = new THREE.TorusGeometry(0.75, 0.055, 8, 40, Math.PI * 1.35);
  private readonly drop = new THREE.SphereGeometry(0.07, 8, 6);
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {}

  update(dt: number, alpha: number, combatants: Combatant[]): void {
    const t = performance.now() / 1000;
    for (const c of combatants) {
      const on = c.alive && c.healTimer > 0;
      let s = this.swirls.get(c.id);
      if (!s && !on) continue;
      if (!s) {
        s = this.create();
        this.swirls.set(c.id, s);
      }
      s.fade = on ? Math.min(1, s.fade + dt * 5) : Math.max(0, s.fade - dt * 3);
      s.group.visible = s.fade > 0;
      if (!s.group.visible) continue;
      const ctl = c.controller;
      this.tmp.lerpVectors(ctl.prevPosition, ctl.position, alpha);
      s.group.position.copy(this.tmp);
      s.bands.forEach((b, i) => {
        const k = i / (s!.bands.length - 1);
        b.position.y = 0.25 + k * 1.35 - (1 - s!.fade) * 0.5;
        b.rotation.set(Math.PI / 2 + Math.sin(t * 2 + i) * 0.35, 0, t * (3.5 + i * 0.8) * (i % 2 ? -1 : 1));
        const r = 0.85 + Math.sin(t * 3 + i * 2) * 0.08;
        b.scale.setScalar(r);
      });
      s.drops.forEach((d, i) => {
        const a = t * 4 + (i / s!.drops.length) * Math.PI * 2;
        const h = 0.3 + ((t * 0.9 + i * 0.37) % 1) * 1.5; // yükselen sarmal
        d.position.set(Math.cos(a) * 0.95, h, Math.sin(a) * 0.95);
      });
      s.mat.opacity = 0.7 * s.fade;
      s.dropMat.opacity = 0.9 * s.fade;
    }
  }

  private create(): Swirl {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4fb8ff,
      emissive: 0x2a8fd6,
      emissiveIntensity: 0.5,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0, depthWrite: false });
    const bands: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(this.band, mat);
      group.add(b);
      bands.push(b);
    }
    const drops: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const d = new THREE.Mesh(this.drop, dropMat);
      group.add(d);
      drops.push(d);
    }
    this.scene.add(group);
    return { group, bands, drops, mat, dropMat, fade: 0 };
  }
}
