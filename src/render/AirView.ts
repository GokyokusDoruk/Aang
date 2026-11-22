import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import type { AirSystem } from '../combat/AirSystem';
import type { Combatant } from '../combat/Combatant';

const WIND = 0xe6f7ff;

/** Hortumlar (dönen, yukarı genişleyen halka yığını) ve rüzgar küreleri (karakteri saran saydam küre). */
export class AirView {
  private readonly tornados = new Map<number, { group: THREE.Group; rings: THREE.Mesh[]; mat: THREE.MeshBasicMaterial }>();
  private readonly spheres = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; inner: THREE.Mesh }>();
  private readonly ringGeo = new THREE.TorusGeometry(1, 0.07, 6, 28);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 24, 16);
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: AirSystem,
  ) {}

  update(dt: number, alpha: number, combatants: Combatant[]): void {
    this.updateTornados(alpha);
    this.updateSpheres(dt, alpha, combatants);
  }

  private updateTornados(alpha: number): void {
    const T = GameConfig.air.tornado;
    const seen = new Set<number>();
    const time = performance.now() / 1000;
    for (const t of this.system.tornados) {
      seen.add(t.id);
      let v = this.tornados.get(t.id);
      if (!v) {
        const group = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: WIND, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        const rings: THREE.Mesh[] = [];
        const n = 11;
        for (let i = 0; i < n; i++) {
          const r = new THREE.Mesh(this.ringGeo, mat);
          r.userData.k = i / (n - 1);
          group.add(r);
          rings.push(r);
        }
        this.scene.add(group);
        v = { group, rings, mat };
        this.tornados.set(t.id, v);
      }
      v.group.position.lerpVectors(t.prevPosition, t.position, alpha);
      v.mat.opacity = 0.5 * Math.max(0, t.strength);
      const grow = Math.min(1, t.age / 0.25);
      for (const r of v.rings) {
        const k = r.userData.k as number;
        // Huni: alt dar, üst geniş; halkalar dalgalanarak döner
        const rad = (0.35 + k * T.radius * 1.1) * grow;
        r.scale.set(rad, rad, rad * 0.9);
        r.position.set(Math.sin(time * 6 + k * 5) * 0.25 * k, k * T.height * grow, Math.cos(time * 6 + k * 5) * 0.25 * k);
        r.rotation.set(Math.PI / 2 + Math.sin(time * 3 + k * 4) * 0.15, 0, time * (8 - k * 3));
      }
    }
    for (const [id, v] of this.tornados) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      v.mat.dispose();
      this.tornados.delete(id);
    }
  }

  private updateSpheres(dt: number, alpha: number, combatants: Combatant[]): void {
    const S = GameConfig.air.sphere;
    for (const c of combatants) {
      const ctl = c.controller;
      const on = c.alive && ctl.sphereTimer > 0;
      let v = this.spheres.get(c.id);
      if (!on) {
        if (v) v.mesh.visible = false;
        continue;
      }
      if (!v) {
        const mat = new THREE.MeshBasicMaterial({ color: WIND, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(this.sphereGeo, mat);
        const inner = new THREE.Mesh(this.ringGeo, mat);
        mesh.add(inner);
        this.scene.add(mesh);
        v = { mesh, mat, inner };
        this.spheres.set(c.id, v);
      }
      v.mesh.visible = true;
      this.tmp.lerpVectors(ctl.prevPosition, ctl.position, alpha);
      const r = S.radius * (ctl.sphereBig ? S.bigScale : 1) * (1 + Math.sin(performance.now() / 60) * 0.03);
      // Karakter kürenin üstüne biner: küre ayakların altında
      this.tmp.y -= r * 0.9;
      v.mesh.position.copy(this.tmp);
      v.mesh.scale.setScalar(r);
      v.inner.rotation.x += dt * 9;
      v.inner.rotation.y += dt * 5;
      v.mat.opacity = ctl.sphereBig ? 0.38 : 0.32;
    }
  }
}
