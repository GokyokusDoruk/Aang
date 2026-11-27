import * as THREE from 'three';
import { ELEMENTS, type ElementId } from '../abilities/elements';
import type { GameEvents } from '../abilities/types';
import type { EventBus } from '../core/EventBus';
import { boulderGeometry } from './rockGeometry';
import { VFX_HDR } from './ParticleField';

/** Bloom açıkken parlak efekt rengini 1'in üzerine taşır (ışıma); kapalıyken olduğu gibi. */
const hdr = (color: number, k: number) => new THREE.Color(color).multiplyScalar(VFX_HDR.value ? k : 1);

const ROCK_COLOR = 0x857d74;
const DUST_COLOR = 0xb89a74;
const WOOD_COLOR = 0xb07a3e;
const ICE_COLOR = 0xbfeaff;
const FIRE_COLOR = 0xff3010;
const WOOD_DARK = 0x7a4f24;
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
  private readonly chunks = [1, 2, 3, 4].map((i) => boulderGeometry(i + 40));
  /** Hava kalkanı sarmalı (seyrek, düşük poligon) */
  private readonly shieldGeo = new THREE.IcosahedronGeometry(1, 1);
  /** Tahta kıymığı / kalas parçası */
  private readonly plank = new THREE.BoxGeometry(0.35, 0.12, 1.6);
  private readonly crater = (() => {
    // Düzensiz kenarlı zemin çatlağı / krater lekesi
    const g = new THREE.CircleGeometry(1, 14);
    const p = g.getAttribute('position');
    for (let i = 1; i < p.count; i++) {
      const k = 0.65 + Math.random() * 0.5;
      p.setXY(i, p.getX(i) * k, p.getY(i) * k);
    }
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  private readonly chunkMats = new Map<number, THREE.MeshStandardMaterial>();

  constructor(
    private readonly scene: THREE.Scene,
    bus: EventBus<GameEvents>,
    /** Parça sayısı çarpanı (mobilde düşük) */
    private readonly effectScale = 1,
  ) {
    // Yer tutucu efekt yalnızca gerçek etkisi (execute) olmayan yetenekler için
    bus.on('ability:cast', (e) => !e.ability.execute && this.spawnCast(e));
    bus.on('projectile:impact', (e) => {
      if (e.kind === 'flame') {
        this.dust(e.point, FIRE_COLOR, 0.5);
        return;
      }
      const color = e.kind === 'rock' ? ROCK_COLOR : ELEMENTS[e.element].color;
      this.debris(e.point, e.normal, color, e.hitCombatant ? 6 : 9, 0.12, 5);
      this.dust(e.point, color, 0.9);
    });
    bus.on('wall:destroyed', (e) => {
      const ice = e.element === 'water';
      for (const c of e.columns) this.debris(c, null, ice ? ICE_COLOR : ROCK_COLOR, ice ? 9 : 7, ice ? 0.14 : 0.2, ice ? 8 : 6);
    });
    bus.on('crate:hit', (e) => this.debris(e.point, null, WOOD_COLOR, 3, 0.06, 4, true));
    bus.on('crate:broken', (e) => {
      this.debris(e.center, UP, WOOD_COLOR, 12, 0.22 * e.size, 7, true);
      this.debris(e.center, UP, WOOD_DARK, 5, 0.18 * e.size, 5, true);
      this.dust(e.center, DUST_COLOR, 1.6 * e.size);
    });
    bus.on('fx:shockwave', (e) => {
      this.shockwave(e);
      this.airShield(e.origin.clone().setY(e.origin.y - 1), false);
    });
    bus.on('fx:explosion', (e) => this.explosion(e));
    // Yanma: her hasar anında gövdeden yükselen kıvılcım
    bus.on('combat:damage', (e) => e.kind === 'burn' && this.debris(e.point, UP, FIRE_COLOR, 4, 0.06, 3));
    bus.on('combat:burn', (e) => this.dust(e.point, FIRE_COLOR, 0.7));
    // Nakavt: ışık sütunu + yerde genişleyen şok halkası + kıvılcım yağmuru
    bus.on('combat:damage', (e) => e.killed && this.knockout(e.point));
    bus.on('combat:downed', (e) => this.dust(e.point, DUST_COLOR, 1.4));
    bus.on('fx:lightning', (e) => this.lightning(e));
    bus.on('fx:burst', (e) => {
      const color = e.element === 'earth' ? DUST_COLOR : ELEMENTS[e.element].color;
      this.dust(e.point, color, e.size * 2.2);
      if (e.element === 'earth') {
        this.debris(e.point, UP, ROCK_COLOR, 5, 0.08 * (1 + e.size), 4);
        this.craterMark(e.point, 0.35 + e.size * 0.6);
      }
    });
  }

  /** Toprak duvarı yükselirken: her sütunun dibinden toz bulutu, fırlayan taşlar ve zemin çatlağı. */
  earthEruption(points: THREE.Vector3[]): void {
    points.forEach((p, i) => {
      this.dust(p, DUST_COLOR, 1.8);
      if (i % 2 === 0) this.debris(p, UP, ROCK_COLOR, 4, 0.12, 6);
      this.craterMark(p, 0.9);
    });
  }

  /** Zeminde kısa süre kalan koyu çatlak izi. */
  private craterMark(at: THREE.Vector3, size: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3b332b, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(this.crater, mat);
    m.position.set(at.x, at.y + 0.02, at.z);
    m.rotation.y = Math.random() * Math.PI * 2;
    this.add({
      obj: m,
      mats: [mat],
      life: 0,
      max: 1.6,
      tick: (t) => {
        m.scale.setScalar(size * Math.min(1, 0.6 + t * 4));
        mat.opacity = 0.5 * (1 - t * t);
      },
    });
  }

  /** Balistik kaya parçaları (paylaşılan geometri/malzeme; ölçekle söner). */
  private debris(at: THREE.Vector3, normal: THREE.Vector3 | null, color: number, count: number, size: number, speed: number, wood = false): void {
    const mat = this.chunkMat(color);
    count = Math.max(2, Math.round(count * this.effectScale));
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(wood ? this.plank : this.chunks[i % this.chunks.length], mat);
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
    const air = e.element === 'air';
    if (air) this.storm(e.point, e.radius);
    // Ateş patlamasının alevi ve dumanı parçacık katmanında (Vfx); burada yalnızca yer halkası
    if (e.element === 'fire') {
      this.groundRing(e.point, e.radius, 0xff3010);
      return;
    }
    const core = new THREE.MeshBasicMaterial({ color: hdr(air ? 0xffffff : 0xfff3b0, 2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const shell = new THREE.MeshBasicMaterial({ color: hdr(air ? 0xa9dcff : 0xff2a08, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
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
    const ringMat = new THREE.MeshBasicMaterial({ color: air ? 0xe6f7ff : 0xff3a14, transparent: true, side: THREE.DoubleSide, depthWrite: false });
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
    if (air) this.dust(e.point, 0xe6f7ff, e.radius * 0.8);
    else this.debris(e.point, UP, 0xff3010, 7, 0.07, 6);
  }

  private groundRing(at: THREE.Vector3, radius: number, color: number): void {
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ring, ringMat);
    ring.position.copy(at);
    ring.rotation.x = -Math.PI / 2;
    this.add({
      obj: ring,
      mats: [ringMat],
      life: 0,
      max: 0.45,
      tick: (t) => {
        ring.scale.setScalar(radius * (0.3 + 0.9 * t));
        ringMat.opacity = 0.6 * (1 - t);
      },
    });
  }

  /** Küçük fırtına: çarpma noktasında yükselip dağılan dönen rüzgar halkaları */
  private storm(at: THREE.Vector3, radius: number): void {
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xe6f7ff, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const ring = new THREE.Mesh(this.ring, mat);
      ring.position.copy(at);
      const tilt = (Math.random() - 0.5) * 0.6;
      const spin = 8 + Math.random() * 6;
      this.add({
        obj: ring,
        mats: [mat],
        life: -i * 0.06,
        max: 0.7,
        tick: (t) => {
          const k = Math.max(0, t);
          ring.position.y = at.y + k * 2.2 + i * 0.3;
          ring.rotation.set(-Math.PI / 2 + tilt, 0, k * spin);
          ring.scale.setScalar(radius * (0.3 + 0.5 * k) * (1 - i * 0.12));
          mat.opacity = 0.6 * (1 - k) * (t >= 0 ? 1 : 0);
        },
      });
    }
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
    // Mor-beyaz şimşek: beyaz çekirdek, mor hale, dağınık ince kollar
    for (const [radius, color, jag, opacity] of [
      [0.05, 0xffffff, 0.7, 1],
      [0.18, 0x9b5cff, 0.7, 0.5],
      [0.035, 0xd9c2ff, 1.6, 0.85],
      [0.03, 0xb88cff, 2.4, 0.6],
    ] as const) {
      const geo = new THREE.TubeGeometry(build(jag), 48, radius, 5, false);
      const mat = new THREE.MeshBasicMaterial({ color: hdr(color, 2.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
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
    this.dust(e.to, 0xb88cff, 1.2);
    this.sparks(e.to, 0xd9c2ff, 10);
    this.sparks(e.from, 0xb88cff, 5);
  }

  /** Hızlı, kısa ömürlü parlak kıvılcımlar (toplamalı) */
  private sparks(at: THREE.Vector3, color: number, count: number): void {
    count = Math.max(2, Math.round(count * this.effectScale));
    const mat = new THREE.MeshBasicMaterial({ color: hdr(color, 3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sphere, mat);
      m.position.copy(at);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(6 + Math.random() * 8);
      this.add({
        obj: m,
        mats: i === 0 ? [mat] : [],
        life: 0,
        max: 0.25 + Math.random() * 0.15,
        tick: (t, dt) => {
          v.y -= 18 * dt;
          m.position.addScaledVector(v, dt);
          m.scale.set(0.03, 0.03, 0.03).multiplyScalar(1.5 - t);
          mat.opacity = 1 - t;
        },
      });
    }
  }

  /**
   * Ayaklardan itiş jeti (çift zıplama / dash): ateşte alev topları, diğer elementlerde renkli puf.
   * dir: jetin püskürdüğü yön (hareketin tersi).
   */
  jet(at: THREE.Vector3, dir: THREE.Vector3, element: ElementId): void {
    const fire = element === 'fire';
    const n = Math.max(3, Math.round((fire ? 12 : 7) * this.effectScale));
    for (let i = 0; i < n; i++) {
      const hot = fire && i % 3 === 0;
      const mat = new THREE.MeshBasicMaterial({
        color: fire ? (hot ? 0xffa050 : i % 2 ? 0xff2a08 : 0xff5018) : element === 'air' ? 0xffffff : ELEMENTS[element].color,
        transparent: true,
        depthWrite: false,
        blending: fire ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const m = new THREE.Mesh(this.sphere, mat);
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
      const v = dir.clone().multiplyScalar(5 + Math.random() * 5).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
      const s0 = (fire ? 0.3 : 0.2) * (0.7 + Math.random() * 0.6);
      this.add({
        obj: m,
        mats: [mat],
        life: 0,
        max: 0.3 + Math.random() * 0.25,
        tick: (t, dt) => {
          v.multiplyScalar(1 - 4 * dt);
          if (fire) v.y += 6 * dt; // sıcak hava yükselir
          m.position.addScaledVector(v, dt);
          m.scale.setScalar(s0 * (0.6 + 1.6 * t));
          mat.opacity = (fire ? 0.95 : 0.5) * (1 - t);
        },
      });
    }
  }

  /** Hava kalkanı: dönen yarı saydam küre + parlayan kabuk (şok dalgası / mermi savuşturma anı). */
  airShield(at: THREE.Vector3, strong: boolean): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, depthWrite: false, side: THREE.DoubleSide, wireframe: true });
    const shell = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
    const g = new THREE.Group();
    const swirl = new THREE.Mesh(this.shieldGeo, mat);
    const glow = new THREE.Mesh(this.sphere, shell);
    g.add(swirl, glow);
    g.position.copy(at).add(new THREE.Vector3(0, 1, 0));
    const r = strong ? 1.5 : 1.25;
    this.add({
      obj: g,
      mats: [mat, shell],
      life: 0,
      max: strong ? 0.5 : 0.38,
      tick: (t, dt) => {
        const k = t < 0.25 ? t / 0.25 : 1;
        g.scale.setScalar(r * (0.6 + 0.4 * k) * (1 + 0.1 * t));
        swirl.rotation.y += dt * 14;
        swirl.rotation.x += dt * 3;
        mat.opacity = 0.55 * (1 - t);
        shell.opacity = (strong ? 0.35 : 0.2) * (1 - t);
      },
    });
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

  /** İniş: zeminde yayılan toz halkası + yanlara savrulan puflar. strength ~0.6..1.7 */
  landDust(at: THREE.Vector3, strength: number): void {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xe8dcc8, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(this.ring, ringMat);
    ring.position.set(at.x, at.y + 0.04, at.z);
    ring.rotation.x = -Math.PI / 2;
    this.add({
      obj: ring,
      mats: [ringMat],
      life: 0,
      max: 0.42,
      tick: (t) => {
        const e = 1 - (1 - t) * (1 - t) * (1 - t); // easeOutCubic
        ring.scale.setScalar(0.25 + strength * 1.1 * e);
        ringMat.opacity = 0.55 * (1 - t) * Math.min(1, strength);
      },
    });
    const n = Math.max(3, Math.round(6 * strength * this.effectScale));
    const mat = new THREE.MeshBasicMaterial({ color: DUST_COLOR, transparent: true, depthWrite: false });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const v = new THREE.Vector3(Math.cos(a), 0.25 + Math.random() * 0.3, Math.sin(a)).multiplyScalar(2.2 + strength * 2.2);
      const m = new THREE.Mesh(this.sphere, mat);
      m.position.set(at.x, at.y + 0.1, at.z);
      const size = 0.12 + Math.random() * 0.1 * strength;
      this.add({
        obj: m,
        mats: i === 0 ? [mat] : [],
        life: 0,
        max: 0.5 + Math.random() * 0.2,
        tick: (t, dt) => {
          v.multiplyScalar(1 - Math.min(1, 5 * dt));
          m.position.addScaledVector(v, dt);
          m.scale.setScalar(size * (0.6 + t * 1.6));
          mat.opacity = 0.5 * (1 - t);
        },
      });
    }
  }

  /** Nakavt patlaması (final vuruşu ağır çekimiyle birlikte görülür) */
  private knockout(at: THREE.Vector3): void {
    const ground = new THREE.Vector3(at.x, Math.max(0, at.y - 0.9), at.z);
    // Işık sütunu
    const beamMat = new THREE.MeshBasicMaterial({ color: hdr(0xfff1c4, 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const beam = new THREE.Mesh(this.sphere, beamMat);
    beam.position.copy(ground);
    this.add({
      obj: beam,
      mats: [beamMat],
      life: 0,
      max: 0.7,
      tick: (t) => {
        const w = 0.55 * (1 - t) + 0.05;
        beam.scale.set(w, 6 * Math.min(1, t * 5), w);
        beamMat.opacity = (1 - t) * (1 - t);
      },
    });
    // İki kademeli şok halkası
    for (const [delay, size, color] of [
      [0, 5, 0xffffff],
      [0.08, 3.2, 0xffc060],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({ color: hdr(color, 1.8), transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const ring = new THREE.Mesh(this.ring, mat);
      ring.position.set(ground.x, ground.y + 0.06, ground.z);
      ring.rotation.x = -Math.PI / 2;
      this.add({
        obj: ring,
        mats: [mat],
        life: -delay,
        max: 0.55,
        tick: (t) => {
          const k = Math.max(0, t);
          const e = 1 - (1 - k) * (1 - k) * (1 - k);
          ring.scale.setScalar(0.3 + size * e);
          mat.opacity = k > 0 ? (1 - k) * 0.9 : 0;
        },
      });
    }
    this.sparks(at, 0xffd27a, 18);
    this.sparks(at, 0xffffff, 8);
  }

  /** Koşu adımı: ayağın arkasında küçük, yükselip dağılan toz pufu */
  footDust(at: THREE.Vector3, speedK: number): void {
    if (this.effectScale < 1 && Math.random() > this.effectScale) return;
    const mat = new THREE.MeshBasicMaterial({ color: 0xd8c6a8, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.sphere, mat);
    m.position.copy(at);
    const rise = 0.4 + Math.random() * 0.3;
    const size = 0.09 + 0.05 * Math.min(2, speedK);
    this.add({
      obj: m,
      mats: [mat],
      life: 0,
      max: 0.45,
      tick: (t, dt) => {
        m.position.y += rise * dt * (1 - t);
        m.scale.set(size * (0.5 + t * 1.4), size * (0.4 + t), size * (0.5 + t * 1.4));
        mat.opacity = 0.32 * (1 - t) * (1 - t);
      },
    });
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
