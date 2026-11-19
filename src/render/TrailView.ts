import * as THREE from 'three';
import type { Combatant } from '../combat/Combatant';

interface Mark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  max: number;
  vel: THREE.Vector3 | null;
  size: number;
}

const ICE_INTERVAL = 0.045;
const WIND_INTERVAL = 0.07;

/**
 * Hareket modlarının iz efektleri (salt görsel, mantığı okur):
 * - Buz Kayması: yerde buz plakaları, havada su damlaları
 * - Rüzgar süzülmesi: karakter etrafında yukarı akan rüzgar çizgileri
 */
export class TrailView {
  private readonly marks: Mark[] = [];
  private readonly hex = new THREE.CircleGeometry(1, 6);
  private readonly drop = new THREE.SphereGeometry(1, 6, 5);
  private readonly streak = new THREE.CylinderGeometry(0.02, 0.02, 1, 4);
  private readonly timers = new Map<string, number>();

  constructor(private readonly scene: THREE.Scene) {}

  update(dt: number, combatants: Combatant[]): void {
    for (const c of combatants) {
      if (!c.alive) continue;
      const ctl = c.controller;
      let t = (this.timers.get(c.id) ?? 0) - dt;
      if (ctl.glideTimer > 0) {
        while (t <= 0) {
          t += ICE_INTERVAL;
          if (ctl.grounded) this.iceMark(ctl.position, ctl.facingYaw);
          else this.droplet(ctl.position);
        }
      } else if (ctl.floatTimer > 0 && !ctl.grounded) {
        while (t <= 0) {
          t += WIND_INTERVAL;
          this.windStreak(ctl.position, ctl.height);
        }
      } else {
        t = 0;
      }
      this.timers.set(c.id, t);
    }

    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.age += dt;
      const k = m.age / m.max;
      if (m.vel) {
        m.vel.y -= 9 * dt;
        m.mesh.position.addScaledVector(m.vel, dt);
      }
      m.mat.opacity = Math.max(0, (m.vel ? 0.8 : 0.55) * (1 - k));
      if (!m.vel) m.mesh.scale.setScalar(m.size * (1 + 0.15 * k));
      if (k >= 1) {
        this.scene.remove(m.mesh);
        m.mat.dispose();
        this.marks.splice(i, 1);
      }
    }
  }

  private add(mesh: THREE.Mesh, mat: THREE.MeshBasicMaterial, max: number, vel: THREE.Vector3 | null, size: number): void {
    this.scene.add(mesh);
    this.marks.push({ mesh, mat, age: 0, max, vel, size });
  }

  private iceMark(pos: THREE.Vector3, yaw: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.hex, mat);
    const size = 0.35 + Math.random() * 0.2;
    m.position.set(pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.02, pos.z + (Math.random() - 0.5) * 0.3);
    m.rotation.set(-Math.PI / 2, 0, yaw + Math.random());
    m.scale.setScalar(size);
    this.add(m, mat, 1.4, null, size);
  }

  private droplet(pos: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.drop, mat);
    m.position.set(pos.x + (Math.random() - 0.5) * 0.5, pos.y + 0.2, pos.z + (Math.random() - 0.5) * 0.5);
    m.scale.setScalar(0.06 + Math.random() * 0.05);
    const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2);
    this.add(m, mat, 0.6, v, 0);
  }

  private windStreak(pos: THREE.Vector3, height: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.streak, mat);
    const a = Math.random() * Math.PI * 2;
    const r = 0.55 + Math.random() * 0.25;
    m.position.set(pos.x + Math.cos(a) * r, pos.y + Math.random() * height * 0.6, pos.z + Math.sin(a) * r);
    m.scale.set(1, 0.5 + Math.random() * 0.4, 1);
    this.add(m, mat, 0.45, new THREE.Vector3(0, 6, 0), 0);
  }
}
