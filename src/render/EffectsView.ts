import * as THREE from 'three';
import { ELEMENTS } from '../abilities/elements';
import type { GameEvents } from '../abilities/types';
import type { EventBus } from '../core/EventBus';

const ROCK_COLOR = 0x7d5f3e;
const DUST_COLOR = 0xb89a74;
const UP = new THREE.Vector3(0, 1, 0);

interface Fx {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  life: number;
  max: number;
  tick(t: number, dt: number): void; // t: 0..1
}

/**
 * Olay yolunu dinleyen geçici görsel efektler.
 * Task 2: her yetenek için yer tutucu "iz + patlama" (elemente göre renk) — nişan/cast hattını doğrulamak için.
 * Task 3-5'te gerçek mermi/duvar görselleri kendi view sınıflarına taşınacak.
 */
export class EffectsView {
  private readonly items: Fx[] = [];
  private readonly sphere = new THREE.SphereGeometry(1, 16, 12);
  private readonly ring = new THREE.RingGeometry(0.75, 1, 32);
  private readonly chunk = new THREE.DodecahedronGeometry(1, 0);
  private readonly chunkMats = new Map<number, THREE.MeshStandardMaterial>();

  constructor(
    private readonly scene: THREE.Scene,
    bus: EventBus<GameEvents>,
  ) {
    // Yer tutucu efekt yalnızca gerçek etkisi (execute) olmayan yetenekler için
    bus.on('ability:cast', (e) => !e.ability.execute && this.spawnCast(e));
    bus.on('projectile:impact', (e) => {
      const color = e.kind === 'rock' ? ROCK_COLOR : ELEMENTS[e.element].color;
      this.debris(e.point, e.normal, color, e.hitCombatant ? 6 : 9, 0.12, 5);
      this.dust(e.point, color, 0.9);
    });
    bus.on('wall:destroyed', (e) => {
      for (const c of e.columns) this.debris(c, null, ROCK_COLOR, 7, 0.2, 6);
    });
    bus.on('fx:shockwave', (e) => this.shockwave(e));
    bus.on('fx:explosion', (e) => this.explosion(e));
    bus.on('fx:lightning', (e) => this.lightning(e));
    bus.on('fx:burst', (e) => {
      const color = e.element === 'earth' ? DUST_COLOR : ELEMENTS[e.element].color;
      this.dust(e.point, color, e.size * 2.2);
      if (e.element === 'earth') this.debris(e.point, UP, ROCK_COLOR, 4, 0.08 * (1 + e.size), 3.5);
    });
  }

  /** Balistik kaya parçaları (paylaşılan geometri/malzeme; ölçekle söner). */
  private debris(at: THREE.Vector3, normal: THREE.Vector3 | null, color: number, count: number, size: number, speed: number): void {
    const mat = this.chunkMat(color);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.chunk, mat);
      m.position.copy(at);
      const s = size * (0.6 + Math.random() * 0.8);
      m.scale.setScalar(s);
      m.castShadow = true;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.4, Math.random() - 0.5).normalize();
      if (normal) v.addScaledVector(normal, 0.8).normalize();
      v.multiplyScalar(speed * (0.5 + Math.random()));
      const spin = new THREE.Vector3(Math.random(), Math.random(), Math.random());
      const floorY = at.y - 3;
      this.add({
        obj: m,
        mats: [],
        life: 0,
        max: 0.7 + Math.random() * 0.5,
        tick: (t) => {
          const dt = 1 / 60;
          v.y -= 22 * dt;
          m.position.addScaledVector(v, dt);
          if (m.position.y < floorY) m.position.y = floorY;
          m.rotation.x += spin.x * 0.3;
          m.rotation.y += spin.y * 0.3;
          m.scale.setScalar(s * (1 - t * t));
        },
      });
    }
  }

  /** Ateş patlaması: parlak çekirdek + genişleyen turuncu küre + yerde halka + kor parçaları */
  private explosion(e: GameEvents['fx:explosion']): void {
    const core = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const shell = new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const a = new THREE.Mesh(this.sphere, core);
    const b = new THREE.Mesh(this.sphere, shell);
    a.position.copy(e.point);
    b.position.copy(e.point);
    this.add({
      obj: a,
      mats: [core],
      life: 0,
      max: 0.2,
      tick: (t) => {
        a.scale.setScalar(e.radius * (0.25 + 0.4 * t));
        core.opacity = 1 - t;
      },
    });
    this.add({
      obj: b,
      mats: [shell],
      life: 0,
      max: 0.45,
      tick: (t) => {
        b.scale.setScalar(e.radius * (0.3 + 0.75 * Math.sqrt(t)));
        shell.opacity = 0.75 * (1 - t);
      },
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(this.ring, ringMat);
    ring.position.copy(e.point);
    ring.rotation.x = -Math.PI / 2;
    this.add({
      obj: ring,
      mats: [ringMat],
      life: 0,
      max: 0.4,
      tick: (t) => {
        ring.scale.setScalar(e.radius * (0.4 + 0.8 * t));
        ringMat.opacity = 0.7 * (1 - t);
      },
    });
    this.debris(e.point, UP, 0xff7a2a, 7, 0.07, 6);
  }

  /** Zikzaklı yıldırım: parlak çekirdek + renkli parıltı, kısa süre titrer */
  private lightning(e: GameEvents['fx:lightning']): void {
    const build = (jag: number) => {
      const pts: THREE.Vector3[] = [];
      const len = e.from.distanceTo(e.to);
      const n = Math.max(4, Math.round(len / 1.2));
      const side = new THREE.Vector3().subVectors(e.to, e.from).normalize();
      const up = Math.abs(side.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const ax = new THREE.Vector3().crossVectors(side, up).normalize();
      const ay = new THREE.Vector3().crossVectors(side, ax).normalize();
      for (let i = 0; i <= n; i++) {
        const p = new THREE.Vector3().lerpVectors(e.from, e.to, i / n);
        if (i > 0 && i < n) p.addScaledVector(ax, (Math.random() - 0.5) * jag).addScaledVector(ay, (Math.random() - 0.5) * jag);
        pts.push(p);
      }
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      return path;
    };
    for (const [radius, color, jag, opacity] of [
      [0.05, 0xffffff, 0.7, 1],
      [0.16, 0xffc94d, 0.7, 0.45],
      [0.04, 0xfff0a0, 1.6, 0.8],
    ] as const) {
      const geo = new THREE.TubeGeometry(build(jag), 48, radius, 5, false);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(geo, mat);
      this.add({
        obj: mesh,
        mats: [mat],
        life: 0,
        max: 0.22,
        tick: (t) => {
          mat.opacity = opacity * (1 - t) * (0.6 + Math.random() * 0.4);
          if (t >= 1) geo.dispose();
        },
      });
    }
    this.dust(e.to, 0xffd36b, 1.2);
  }

  /** Koni biçimli rüzgar dalgası + ileri giden halkalar */
  private shockwave(e: GameEvents['fx:shockwave']): void {
    const color = ELEMENTS[e.element].color;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), e.direction);

    const radius = Math.tan(Math.min(e.halfAngle, 1.3)) * e.range;
    const coneGeo = new THREE.ConeGeometry(radius, e.range, 28, 1, true);
    coneGeo.translate(0, -e.range / 2, 0); // tepe noktası orijinde, ağız -Y yönünde
    const coneMat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.copy(e.origin);
    cone.quaternion.copy(q);
    this.add({
      obj: cone,
      mats: [coneMat],
      life: 0,
      max: 0.35,
      tick: (t) => {
        cone.scale.setScalar(0.25 + 0.75 * Math.sqrt(t));
        coneMat.opacity = 0.32 * (1 - t);
        if (t >= 1) coneGeo.dispose();
      },
    });

    for (let i = 0; i < 3; i++) {
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(this.ring, ringMat);
      const delay = i * 0.06;
      this.add({
        obj: ring,
        mats: [ringMat],
        life: 0,
        max: 0.45,
        tick: (t) => {
          const k = Math.max(0, (t * 0.45 - delay) / (0.45 - delay));
          const dist = e.range * k;
          ring.position.copy(e.origin).addScaledVector(e.direction, dist);
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), e.direction);
          ring.scale.setScalar(0.3 + Math.tan(Math.min(e.halfAngle, 1.3)) * dist * 0.9);
          ringMat.opacity = k > 0 ? 0.55 * (1 - k) : 0;
        },
      });
    }
  }

  /** Genişleyen toz halkası */
  private dust(at: THREE.Vector3, color: number, size: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.sphere, mat);
    m.position.copy(at);
    this.add({
      obj: m,
      mats: [mat],
      life: 0,
      max: 0.35,
      tick: (t) => {
        m.scale.set(size * (0.3 + t), size * 0.45 * (0.3 + t), size * (0.3 + t));
        mat.opacity = 0.55 * (1 - t);
      },
    });
  }

  private chunkMat(color: number): THREE.MeshStandardMaterial {
    let m = this.chunkMats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
      this.chunkMats.set(color, m);
    }
    return m;
  }

  private spawnCast(e: GameEvents['ability:cast']): void {
    const color = ELEMENTS[e.ability.element].color;
    const big = e.ability.slot === 'secondary';

    // İz çizgisi
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([e.origin, e.target]), lineMat);
    this.add({ obj: line, mats: [lineMat], life: 0, max: 0.25, tick: (t) => (lineMat.opacity = 1 - t) });

    // Hedefte genişleyen küre
    const burstMat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const burst = new THREE.Mesh(this.sphere, burstMat);
    burst.position.copy(e.target);
    const r = big ? 1.4 : 0.6;
    this.add({
      obj: burst,
      mats: [burstMat],
      life: 0,
      max: 0.4,
      tick: (t) => {
        burst.scale.setScalar(0.2 + r * t);
        burstMat.opacity = 0.8 * (1 - t);
      },
    });

    // Zeminde halka
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(this.ring, ringMat);
    ring.position.copy(e.target).y += 0.05;
    ring.rotation.x = -Math.PI / 2;
    this.add({
      obj: ring,
      mats: [ringMat],
      life: 0,
      max: 0.5,
      tick: (t) => {
        ring.scale.setScalar(0.3 + (big ? 2.5 : 1.2) * t);
        ringMat.opacity = 0.9 * (1 - t);
      },
    });

    // Çıkış noktasında parlama
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
    const flash = new THREE.Mesh(this.sphere, flashMat);
    flash.position.copy(e.origin);
    this.add({
      obj: flash,
      mats: [flashMat],
      life: 0,
      max: 0.15,
      tick: (t) => {
        flash.scale.setScalar(0.25 * (1 - t) + 0.05);
        flashMat.opacity = 1 - t;
      },
    });
  }

  private add(fx: Fx): void {
    fx.tick(0, 0);
    this.scene.add(fx.obj);
    this.items.push(fx);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const fx = this.items[i];
      fx.life += dt;
      const t = Math.min(1, fx.life / fx.max);
      fx.tick(t, dt);
      if (t >= 1) {
        this.scene.remove(fx.obj);
        for (const m of fx.mats) m.dispose();
        if (fx.obj instanceof THREE.Line) fx.obj.geometry.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
