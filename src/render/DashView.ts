import * as THREE from 'three';
import type { ElementId } from '../abilities/elements';
import type { Combatant } from '../combat/Combatant';
import type { PlayerView } from './PlayerView';
import { boulderGeometry } from './rockGeometry';

export interface DashFighter {
  c: Combatant;
  view: PlayerView;
  element: ElementId;
}

interface Slab {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  earth: boolean;
  /** Dash bittikten sonra geçen süre (-1 = hâlâ taşıyor) */
  after: number;
  vel: THREE.Vector3;
}

interface Particle {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  age: number;
  max: number;
  size: number;
  rise: number;
}

/** Dash bittikten sonra da kısa süre parçacık / plaka devam eder (s) */
const TAIL = 0.12;
const SLAB_FADE = 0.55;
const LIMB_RATE = 45;
/** Plaka kalınlıkları: karakter dash boyunca bu kadar yükselir (görsel) */
const EARTH_LIFT = 0.32;
const ICE_LIFT = 0.12;
const EARTH_HALF = 0.17;
const ICE_HALF = 0.05;

/**
 * Elemente göre dash görseli:
 * - Toprak: ayağının altında seni taşıyan taş plaka (bitince düşüp ufalanır)
 * - Su: altında kayan buz levhası (bitince erir)
 * - Hava: ellerden ve ayaklardan geriye savrulan rüzgar
 * - Ateş: ellerden ve ayaklardan geriye püsküren alev
 */
export class DashView {
  private readonly slabs = new Map<string, Slab>();
  private readonly fading: Slab[] = [];
  private readonly particles: Particle[] = [];
  private readonly tails = new Map<string, number>();
  private readonly emit = new Map<string, number>();
  private readonly orb = new THREE.SphereGeometry(1, 8, 6);
  private readonly streak = new THREE.CylinderGeometry(0.5, 0.15, 1, 5, 1, true);
  private readonly rockGeo = boulderGeometry(7);
  private readonly iceGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly limbs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly back = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly scene: THREE.Scene,
    /** Parça sayısı çarpanı (mobilde düşük) */
    private readonly scale = 1,
  ) {}

  update(dt: number, fighters: DashFighter[]): void {
    for (const f of fighters) this.fighter(dt, f);
    this.updateSlabs(dt);
    this.updateParticles(dt);
  }

  private fighter(dt: number, f: DashFighter): void {
    const ctl = f.c.controller;
    const id = f.c.id;
    let tail = this.tails.get(id) ?? 0;
    if (f.c.alive && ctl.dashing) tail = TAIL;
    else tail = Math.max(0, tail - dt);
    this.tails.set(id, tail);
    const active = f.c.alive && tail > 0 && f.view.root.visible;

    const el = f.element;
    const wantsSlab = active && (el === 'earth' || el === 'water');
    let slab = this.slabs.get(id);
    if (slab && (!wantsSlab || slab.earth !== (el === 'earth'))) {
      this.release(slab, ctl.velocity);
      this.slabs.delete(id);
      slab = undefined;
    }
    if (wantsSlab && !slab) {
      slab = this.createSlab(el === 'earth');
      this.slabs.set(id, slab);
    }
    if (slab) {
      // Karakter plakanın üstüne çıkar (yalnızca görsel), plaka ayağının altında, bakış yönünde
      const root = f.view.root;
      const lift = (slab.earth ? EARTH_LIFT : ICE_LIFT) * Math.min(1, tail / (TAIL * 0.5));
      root.position.y += lift;
      const half = slab.earth ? EARTH_HALF : ICE_HALF;
      slab.mesh.position.set(root.position.x, root.position.y - half, root.position.z);
      slab.mesh.rotation.set(slab.earth ? -0.12 : -0.06, root.rotation.y, 0, 'YXZ');
      if (Math.random() < dt * 40 * this.scale) this.rearSpray(f, slab.earth);
    }

    if (active && (el === 'air' || el === 'fire')) {
      this.back.set(-ctl.velocity.x, 0, -ctl.velocity.z);
      if (this.back.lengthSq() < 1e-3) this.back.set(Math.sin(f.view.root.rotation.y), 0, Math.cos(f.view.root.rotation.y));
      this.back.normalize();
      f.view.limbPoints(this.limbs);
      // Kare hızından bağımsız: uzuv başına saniyede ~LIMB_RATE parçacık
      let acc = (this.emit.get(id) ?? 0) + dt * LIMB_RATE * this.scale;
      while (acc >= 1) {
        acc -= 1;
        for (const p of this.limbs) el === 'fire' ? this.flame(p) : this.wind(p);
      }
      this.emit.set(id, acc);
    }
  }

  private createSlab(earth: boolean): Slab {
    const mat = earth
      ? new THREE.MeshStandardMaterial({ color: 0x8e8983, roughness: 0.95, flatShading: true, transparent: true, opacity: 1 })
      : new THREE.MeshStandardMaterial({ color: 0xc4ecff, emissive: 0x5cc8ff, emissiveIntensity: 0.3, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(earth ? this.rockGeo : this.iceGeo, mat);
    if (earth) mesh.scale.set(0.8, EARTH_HALF * 1.3, 1.1);
    else mesh.scale.set(1.1, ICE_HALF * 2, 1.7);
    mesh.castShadow = earth;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return { mesh, mat, earth, after: -1, vel: new THREE.Vector3() };
  }

  /** Dash bitti: plaka biraz daha kayar, sonra toprak düşüp ufalanır / buz erir. */
  private release(s: Slab, vel: THREE.Vector3): void {
    s.after = 0;
    s.vel.set(vel.x * 0.4, 0, vel.z * 0.4);
    this.fading.push(s);
  }

  private updateSlabs(dt: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const s = this.fading[i];
      s.after += dt;
      const k = s.after / SLAB_FADE;
      s.vel.multiplyScalar(1 - 5 * dt);
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.earth) {
        s.mesh.position.y -= dt * 0.6 * k * 4; // batar
        if (Math.random() < dt * 25) this.dust(s.mesh.position, 0x9a8f80);
      } else {
        s.mesh.scale.y = ICE_HALF * 2 * (1 - k * 0.7); // erir, incelir
      }
      s.mat.opacity = (s.earth ? 1 : 0.8) * Math.max(0, 1 - k);
      if (k >= 1) {
        this.scene.remove(s.mesh);
        s.mat.dispose();
        this.fading.splice(i, 1);
      }
    }
  }

  /** Plakanın arkasından: toprakta toz / taş kırıntısı, suda buz kristali serpintisi */
  private rearSpray(f: DashFighter, earth: boolean): void {
    const ctl = f.c.controller;
    const r = f.view.root.position;
    this.back.set(-ctl.velocity.x, 0, -ctl.velocity.z).normalize();
    const at = new THREE.Vector3(r.x + this.back.x * 0.7, r.y + 0.05, r.z + this.back.z * 0.7);
    const vel = this.back.clone().multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2));
    this.spawn(at, vel, earth ? 0x8a7f72 : 0xe6f8ff, earth ? 0.08 : 0.06, 0.35, earth ? -9 : -6, !earth);
  }

  private wind(p: THREE.Vector3): void {
    const vel = this.back.clone().multiplyScalar(9 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5));
    this.spawn(p.clone(), vel, 0xffffff, 0.07, 0.28, 0, false, true);
  }

  private flame(p: THREE.Vector3): void {
    const vel = this.back.clone().multiplyScalar(7 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, Math.random() * 1.2, (Math.random() - 0.5) * 1.5));
    const hot = Math.random() < 0.2;
    this.spawn(p.clone(), vel, hot ? 0xffe27a : Math.random() < 0.5 ? 0xff6a10 : 0xff9a2a, hot ? 0.07 : 0.09, 0.3, 5, hot);
  }

  private dust(at: THREE.Vector3, color: number): void {
    const vel = new THREE.Vector3((Math.random() - 0.5) * 2, 0.8 + Math.random(), (Math.random() - 0.5) * 2);
    this.spawn(at.clone(), vel, color, 0.12, 0.45, -2, false);
  }

  private spawn(at: THREE.Vector3, vel: THREE.Vector3, color: number, size: number, max: number, rise: number, additive: boolean, streak = false): void {
    if (this.particles.length > 600) return;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(streak ? this.streak : this.orb, mat);
    mesh.position.copy(at);
    if (streak) mesh.quaternion.setFromUnitVectors(this.up, vel.clone().normalize());
    this.scene.add(mesh);
    this.particles.push({ mesh, mat, vel, age: 0, max: max * (0.8 + Math.random() * 0.4), size, rise });
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      const k = p.age / p.max;
      p.vel.multiplyScalar(1 - 3 * dt);
      p.vel.y += p.rise * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const isStreak = p.mesh.geometry === this.streak;
      if (isStreak) {
        // Rüzgar çizgisi: hızla uzar, incelir
        p.mesh.scale.set(p.size * (1 - k * 0.6), 0.5 + p.vel.length() * 0.06, p.size * (1 - k * 0.6));
      } else {
        p.mesh.scale.setScalar(p.size * (0.7 + 1.4 * k));
      }
      p.mat.opacity = (isStreak ? 0.5 : 0.8) * (1 - k);
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mat.dispose();
        this.particles.splice(i, 1);
      }
    }
  }
}
