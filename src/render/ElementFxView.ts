import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import type { AbilitySystem } from '../abilities/AbilitySystem';
import type { Combatant } from '../combat/Combatant';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { PlayerView } from './PlayerView';
import { boulderGeometry } from './rockGeometry';

export interface FxFighter {
  c: Combatant;
  view: PlayerView;
  abilities: AbilitySystem;
}

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  age: number;
  max: number;
  size: number;
  grow: number;
  drag: number;
  rise: number;
  baseOpacity: number;
  /** Sarıdan kırmızıya renk geçişi (alev) */
  flame: boolean;
  streak: boolean;
  solid: boolean;
}

interface Armor {
  group: THREE.Group;
  plates: THREE.Mesh[];
  mat: THREE.MeshStandardMaterial;
}

interface Bubble {
  mesh: THREE.Mesh;
  inner: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  fade: number;
}

const FLAME_HOT = new THREE.Color(0xfff1a8);
const FLAME_MID = new THREE.Color(0xff8a1a);
const FLAME_COLD = new THREE.Color(0xc2280a);
const SMOKE = new THREE.Color(0x3a2a24);

/**
 * E yeteneklerinin görselleri:
 * - Su Küresi: karakteri saran dalgalanan su küresi
 * - Toprak Zırhı: gövdeyi saran taş plakalar (zırh azaldıkça dökülür)
 * - Ateş Nefesi: ağızdan yayılan alev konisi; şarj ederken ağızda büyüyen ateş topu ve içe çekilen kıvılcımlar
 * - Rüzgar Patlaması: dışa açılan rüzgar halkaları ve savrulan çizgiler (güçlüsünde girdap + toz)
 */
export class ElementFxView {
  private readonly particles: Particle[] = [];
  private readonly armors = new Map<string, Armor>();
  private readonly bubbles = new Map<string, Bubble>();
  private readonly orbs = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; glow: THREE.Mesh }>();
  private readonly rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; max: number; r0: number; r1: number; y: number; spin: number }[] = [];
  private readonly orb = new THREE.SphereGeometry(1, 10, 8);
  private readonly bubbleGeo = new THREE.SphereGeometry(1, 32, 24);
  private readonly streak = new THREE.CylinderGeometry(0.5, 0.12, 1, 5, 1, true);
  private readonly ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 48);
  private readonly plateGeos = [1, 2, 3, 4].map((i) => boulderGeometry(20 + i));
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly tmp = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    bus: EventBus<GameEvents>,
    private readonly scale = 1,
  ) {
    bus.on('fx:breath', (e) => this.breath(e));
    bus.on('fx:windBurst', (e) => this.windBurst(e));
    bus.on('combat:armorHit', (e) => {
      const n = e.broken ? 14 : 4;
      for (let i = 0; i < n; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
        this.spawn(e.point.clone(), v, 0x8e8983, 0.09 + Math.random() * 0.06, 0.7, -14, 0, 1, false);
      }
    });
  }

  update(dt: number, alpha: number, combatants: Combatant[], fighters: FxFighter[]): void {
    for (const c of combatants) {
      this.updateBubble(dt, alpha, c);
      this.updateArmor(alpha, c);
    }
    const seen = new Set<string>();
    for (const f of fighters) {
      const ch = f.abilities.chargedActive;
      if (f.c.alive && ch && ch.charged.id === 'fireBreathCharged') {
        seen.add(f.c.id);
        this.chargeBreath(dt, f, ch.progress);
      }
    }
    for (const [id, o] of this.orbs) {
      if (seen.has(id)) continue;
      this.scene.remove(o.mesh);
      o.mat.dispose();
      this.orbs.delete(id);
    }
    this.updateRings(dt);
    this.updateParticles(dt);
  }

  // ---------------------------------------------------------------- Su Küresi

  private updateBubble(dt: number, alpha: number, c: Combatant): void {
    const on = c.alive && c.sphereTimer > 0;
    let b = this.bubbles.get(c.id);
    if (!b && !on) return;
    if (!b) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x3fa9ff,
        emissive: 0x1a6fd6,
        emissiveIntensity: 0.35,
        roughness: 0.05,
        metalness: 0.2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.bubbleGeo, mat);
      const inner = new THREE.Mesh(this.ringGeo, mat);
      mesh.add(inner);
      this.scene.add(mesh);
      b = { mesh, inner, mat, fade: 0 };
      this.bubbles.set(c.id, b);
    }
    b.fade = on ? Math.min(1, b.fade + dt * 4) : Math.max(0, b.fade - dt * 3);
    b.mesh.visible = b.fade > 0;
    if (!b.mesh.visible) return;
    const ctl = c.controller;
    this.tmp.lerpVectors(ctl.prevPosition, ctl.position, alpha);
    const R = GameConfig.water.sphere.radius;
    const t = performance.now() / 1000;
    b.mesh.position.set(this.tmp.x, this.tmp.y + ctl.height * 0.5, this.tmp.z);
    // Dalgalanan su yüzeyi: eksenlerde farklı fazlarla nefes alır
    b.mesh.scale.set(R * (1 + Math.sin(t * 5) * 0.04), R * (1 + Math.sin(t * 4 + 1) * 0.05) * (0.6 + 0.4 * b.fade), R * (1 + Math.cos(t * 4.5) * 0.04));
    b.mesh.rotation.y += dt * 1.2;
    b.inner.rotation.x += dt * 2.5;
    b.mat.opacity = 0.42 * b.fade;
    // Yüzeyde yukarı süzülen kabarcıklar
    if (on && Math.random() < dt * 18 * this.scale) {
      const a = Math.random() * Math.PI * 2;
      const p = new THREE.Vector3(this.tmp.x + Math.cos(a) * R * 0.85, this.tmp.y + 0.2, this.tmp.z + Math.sin(a) * R * 0.85);
      this.spawn(p, new THREE.Vector3(0, 1.2 + Math.random(), 0), 0xdff6ff, 0.05, 0.9, 0, 0.5, 0.8, false);
    }
  }

  // ---------------------------------------------------------------- Toprak Zırhı

  private updateArmor(alpha: number, c: Combatant): void {
    const on = c.alive && c.armor > 0;
    let a = this.armors.get(c.id);
    if (!on) {
      if (a) a.group.visible = false;
      return;
    }
    if (!a) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.95, flatShading: true });
      const group = new THREE.Group();
      const plates: THREE.Mesh[] = [];
      // Gövdeyi saran plakalar: omuzlar, göğüs, sırt, kalçalar, baldırlar
      const spots = [
        [-0.27, 1.38, 0, 0.17],
        [0.27, 1.38, 0, 0.17],
        [0, 1.15, -0.17, 0.2],
        [0, 1.15, 0.17, 0.2],
        [-0.2, 0.9, -0.1, 0.15],
        [0.2, 0.9, -0.1, 0.15],
        [-0.12, 0.45, -0.08, 0.12],
        [0.12, 0.45, -0.08, 0.12],
        [0, 1.6, 0.02, 0.13],
        [-0.33, 1.05, 0.05, 0.12],
        [0.33, 1.05, 0.05, 0.12],
      ];
      const s = GameConfig.player.height / 1.8;
      spots.forEach(([x, y, z, r], i) => {
        const m = new THREE.Mesh(this.plateGeos[i % this.plateGeos.length], mat);
        m.position.set(x * s, y * s, z * s);
        m.userData.r = r;
        m.scale.set(r * 1.2, r, r * 0.8);
        m.rotation.set(Math.random(), Math.random() * 6, Math.random());
        m.castShadow = true;
        group.add(m);
        plates.push(m);
      });
      this.scene.add(group);
      a = { group, plates, mat };
      this.armors.set(c.id, a);
    }
    a.group.visible = true;
    const ctl = c.controller;
    this.tmp.lerpVectors(ctl.prevPosition, ctl.position, alpha);
    a.group.position.copy(this.tmp);
    a.group.rotation.y = ctl.facingYaw;
    // Zırh azaldıkça plakalar dökülür; ağır zırhta plakalar iri
    const frac = c.armor / Math.max(1, c.armorMax);
    const heavy = c.armorMax >= GameConfig.earth.armor.heavy;
    const visible = Math.ceil(a.plates.length * frac);
    a.plates.forEach((p, i) => {
      p.visible = i < visible;
      const r = (p.userData.r as number) * (heavy ? 1.35 : 1);
      p.scale.set(r * 1.2, r, r * 0.8);
    });
    a.mat.color.setHex(heavy ? 0x6f665c : 0x8a7f72);
  }

  // ---------------------------------------------------------------- Ateş Nefesi

  /** Şarj: ağızda büyüyen ateş topu, etraftan içe çekilen kıvılcımlar */
  private chargeBreath(dt: number, f: FxFighter, progress: number): void {
    f.view.headPoint(this.mouth);
    let o = this.orbs.get(f.c.id);
    if (!o) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(this.orb, mat);
      const glow = new THREE.Mesh(this.orb, new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(1.8);
      mesh.add(glow);
      this.scene.add(mesh);
      o = { mesh, mat, glow };
      this.orbs.set(f.c.id, o);
    }
    const t = performance.now() / 1000;
    o.mesh.position.copy(this.mouth);
    o.mesh.scale.setScalar((0.06 + progress * 0.2) * (1 + Math.sin(t * 30) * 0.12));
    o.mat.color.copy(FLAME_MID).lerp(FLAME_HOT, progress);
    // İçe çekilen kıvılcımlar
    const n = Math.random() < dt * (20 + progress * 60) * this.scale ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      const dist = 0.9 + Math.random() * 0.8;
      const from = this.mouth.clone().addScaledVector(dir, dist);
      const vel = dir.clone().multiplyScalar(-dist / 0.3);
      this.spawn(from, vel, 0xffc46b, 0.035, 0.3, 0, -0.5, 1, true);
    }
    // Tam güçte ağızdan duman kıvrımı
    if (progress >= 1 && Math.random() < dt * 12) {
      this.spawn(this.mouth.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2, (Math.random() - 0.5) * 0.4), 0x55504a, 0.06, 0.8, 0, 1.6, 0.35, false);
    }
  }

  /** Nefes: koni içinde ileri püsküren, yayılan, kırmızıya dönen alev dilleri */
  private breath(e: GameEvents['fx:breath']): void {
    const n = Math.round((28 + e.charge * 55) * this.scale);
    const dir = e.direction.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, this.up).normalize();
    const upv = new THREE.Vector3().crossVectors(side, dir).normalize();
    const speed = e.range / 0.35;
    for (let i = 0; i < n; i++) {
      // Koni içinde rastgele yön
      const ang = Math.random() * Math.PI * 2;
      const spread = Math.tan(e.halfAngle) * Math.sqrt(Math.random());
      const d = dir.clone().addScaledVector(side, Math.cos(ang) * spread).addScaledVector(upv, Math.sin(ang) * spread).normalize();
      const delay = Math.random() * 0.18;
      const from = e.origin.clone().addScaledVector(d, -delay * speed * 0.15);
      const v = d.multiplyScalar(speed * (0.75 + Math.random() * 0.4));
      const size = 0.06 + Math.random() * 0.05 + e.charge * 0.03;
      const hot = Math.random() < 0.3;
      this.spawn(from, v, 0xffffff, size, 0.4 + Math.random() * 0.2, 0, 1.8 + e.charge, hot ? 0.8 : 0.9, true, false, 2.6, -delay, !hot);
    }
    // Ağızda parlama
    this.spawn(e.origin.clone(), new THREE.Vector3(), 0xfff1a8, 0.15 + e.charge * 0.15, 0.15, 0, 2, 0.8, true);
    // Tam şarjda yerde yanık halkası
    if (e.charge > 0.6) this.ring(e.origin.clone().addScaledVector(dir, e.range * 0.5).setY(e.origin.y - 1.5), e.range * 0.3, e.range * 0.7, 0xff6a10, 0.5, 0);
  }

  // ---------------------------------------------------------------- Rüzgar Patlaması

  private windBurst(e: GameEvents['fx:windBurst']): void {
    const o = e.origin;
    const count = e.strong ? 4 : 2;
    for (let i = 0; i < count; i++) this.ring(new THREE.Vector3(o.x, o.y + 0.3 + i * 0.45, o.z), 0.6, e.radius * (1 - i * 0.08), 0xe6f7ff, 0.45 + i * 0.07, e.strong ? 6 : 0, i * 0.05);
    const n = Math.round((e.strong ? 70 : 36) * this.scale);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const h = 0.2 + Math.random() * (e.strong ? 2.4 : 1.6);
      const from = new THREE.Vector3(o.x + Math.cos(a) * 0.6, o.y + h, o.z + Math.sin(a) * 0.6);
      const sp = e.radius / 0.35;
      // Güçlüde teğetsel girdap bileşeni
      const v = new THREE.Vector3(Math.cos(a) * sp, Math.random() * 2, Math.sin(a) * sp);
      if (e.strong) v.add(new THREE.Vector3(-Math.sin(a) * sp * 0.35, 0, Math.cos(a) * sp * 0.35));
      this.spawn(from, v, 0xffffff, 0.06, 0.4, 0, 0, 0.6, false, true, 3);
    }
    if (e.strong) {
      for (let i = 0; i < 24 * this.scale; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * 9, 1 + Math.random() * 2, Math.sin(a) * 9);
        this.spawn(new THREE.Vector3(o.x, o.y + 0.1, o.z), v, 0xcfc3ad, 0.2, 0.7, 0, 2.2, 0.5, false, false, 3);
      }
    }
  }

  // ---------------------------------------------------------------- yardımcılar

  private ring(at: THREE.Vector3, r0: number, r1: number, color: number, max: number, spin: number, delay = 0): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(at);
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, age: -delay, max, r0, r1, y: at.y, spin });
  }

  private updateRings(dt: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = Math.max(0, r.age / r.max);
      const e = 1 - (1 - Math.min(1, k)) ** 3;
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      r.mesh.rotation.z += r.spin * dt;
      r.mat.opacity = r.age < 0 ? 0 : 0.75 * (1 - k);
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
      }
    }
  }

  private spawn(
    at: THREE.Vector3,
    vel: THREE.Vector3,
    color: number,
    size: number,
    max: number,
    rise: number,
    grow: number,
    opacity: number,
    flame: boolean,
    streak = false,
    drag = 1.5,
    age = 0,
    /** Alev ama toplamalı değil (renk geçişli, üst üste binince beyaza dönmez) */
    solid = false,
  ): void {
    if (this.particles.length > 900) return;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: flame && !solid ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(streak ? this.streak : this.orb, mat);
    mesh.position.copy(at);
    if (streak && vel.lengthSq() > 1e-6) mesh.quaternion.setFromUnitVectors(this.up, vel.clone().normalize());
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.particles.push({ mesh, mat, vel, age, max, size, grow, drag, rise, baseOpacity: opacity, flame, streak, solid });
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age < 0) continue;
      const k = p.age / p.max;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.vel.y += p.rise * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.streak) {
        p.mesh.scale.set(p.size * (1 - k * 0.6), 0.4 + p.vel.length() * 0.05, p.size * (1 - k * 0.6));
      } else {
        p.mesh.scale.setScalar(p.size * (1 + p.grow * k));
      }
      if (p.flame && p.solid) {
        // Gövde alevi: turuncu → koyu kırmızı → is
        if (k < 0.55) p.mat.color.copy(FLAME_MID).lerp(FLAME_COLD, k / 0.55);
        else p.mat.color.copy(FLAME_COLD).lerp(SMOKE, (k - 0.55) / 0.45);
      } else if (p.flame) {
        // Sarı → turuncu → koyu kırmızı
        if (k < 0.4) p.mat.color.copy(FLAME_HOT).lerp(FLAME_MID, k / 0.4);
        else p.mat.color.copy(FLAME_MID).lerp(FLAME_COLD, Math.min(1, (k - 0.4) / 0.6));
      }
      p.mat.opacity = p.baseOpacity * (1 - k) * Math.min(1, p.age / 0.03 + 0.3);
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}
