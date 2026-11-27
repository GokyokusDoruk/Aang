import * as THREE from 'three';
import type { Combatant } from '../combat/Combatant';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { ParticleField, glowTexture, puffTexture, type EmitOptions } from './ParticleField';

const C = (hex: number) => new THREE.Color(hex);

// Ateş: turuncu-kızıl çekirdek → kırmızı → koyu kor (toplamalı parıltı katmanı)
const FIRE_HOT = C(0xff8a2a);
const FIRE_MID = C(0xff2a08);
const FIRE_END = C(0x6a0400);
// Alevin gövdesi (normal karışım): açık zeminde de kaybolmayan doygun kırmızı
const FIRE_BODY_0 = C(0xf0300a);
const FIRE_BODY_1 = C(0x5a0600);
const SMOKE_0 = C(0x4a403a);
const SMOKE_1 = C(0x8a8580);
const DUST_0 = C(0x9a8a74);
const DUST_1 = C(0xc8baa4);
const FROST_0 = C(0xffffff);
const FROST_1 = C(0x6fd0ff);
const WIND_0 = C(0xffffff);
const WIND_1 = C(0xbfe6ff);
// Alev Akımı kaynağı: mavi-beyaz sıcak çekirdek (gaz alevi gibi)
const BLUE_HOT = C(0xbfe2ff);
const BLUE_MID = C(0x2f63ff);
const Y_UP = new THREE.Vector3(0, 1, 0);

const rnd = (a: number) => (Math.random() - 0.5) * 2 * a;

/**
 * Büyü görsellerinin parçacık katmanı. Mermiler her karede iz bırakır,
 * patlama / isabet / nefes / yanma olayları parçacık püskürtür.
 */
export class Vfx {
  readonly fire: ParticleField;
  /** Alevin altında çizilen opak kırmızı gövde: ateşi her zeminde belirgin kılar */
  private readonly fireBody: ParticleField;
  readonly smoke: ParticleField;
  readonly dust: ParticleField;
  readonly frost: ParticleField;
  readonly wind: ParticleField;
  private readonly fields: ParticleField[];

  constructor(
    scene: THREE.Scene,
    bus: EventBus<GameEvents>,
    /** Parçacık sayısı çarpanı (mobilde düşük) */
    private readonly scale = 1,
  ) {
    const glow = glowTexture();
    const puff = puffTexture();
    this.fire = new ParticleField(scene, Math.round(6000 * scale), glow, true, 2.8);
    this.fireBody = new ParticleField(scene, Math.round(4000 * scale), glow, false, 1.8);
    this.frost = new ParticleField(scene, Math.round(2000 * scale), glow, true, 1.8);
    this.wind = new ParticleField(scene, Math.round(2000 * scale), puff, true, 1.3);
    this.smoke = new ParticleField(scene, Math.round(2000 * scale), puff, false);
    this.dust = new ParticleField(scene, Math.round(2000 * scale), puff, false);
    this.fields = [this.smoke, this.dust, this.frost, this.wind, this.fireBody, this.fire];

    bus.on('fx:explosion', (e) => {
      if (e.element === 'fire') this.fireExplosion(e.point, e.radius);
      else if (e.element === 'air') this.windBurst(e.point, e.radius);
      else if (e.element === 'earth') this.dustBurst(e.point, e.radius * 0.8, 60);
    });
    bus.on('projectile:impact', (e) => {
      if (e.kind === 'flame') this.fireBurst(e.point, 0.6, 10);
      else if (e.kind === 'shard') this.frostBurst(e.point, 18);
      else if (e.kind === 'rock') this.dustBurst(e.point, 0.8, 18);
    });
    bus.on('fx:breath', (e) => this.breath(e));
    bus.on('fx:windBurst', (e) => this.gust(e.origin, e.radius, e.strong));
    bus.on('combat:burn', (e) => this.fireBurst(e.point, 0.4, 14));
  }

  /** Karede bir: parçacıkları ilerlet, yanan dövüşçüleri tutuştur */
  update(dt: number, combatants: Combatant[], viewportHeight: number, fov: number): void {
    for (const c of combatants) {
      if (!c.alive || !c.burning) continue;
      // Gövdeden yükselen alevler
      const n = this.count(dt, 160);
      const p = c.position;
      for (let i = 0; i < n; i++) {
        const h = Math.random() * c.height * 0.95;
        const a = Math.random() * Math.PI * 2;
        const r = 0.28 + Math.random() * 0.12;
        this.flameParticle(p.x + Math.cos(a) * r, p.y + h, p.z + Math.sin(a) * r, Math.cos(a) * 0.5, 1 + Math.random() * 1.2, Math.sin(a) * 0.5, 0.55, 0.45);
      }
      if (Math.random() < dt * 8) this.smokeParticle(p.x, p.y + c.height, p.z, 0.5);
    }
    this.updateBreaths(dt);
    for (const f of this.fields) {
      f.setViewportHeight(viewportHeight, fov);
      f.update(dt);
    }
  }

  // ================================================================ mermi izleri (ProjectileView her karede çağırır)

  /** Ateş topu: yanan çekirdek, arkada uzayan alev dili ve hafif duman */
  fireballTrail(p: THREE.Vector3, v: THREE.Vector3, r: number, dt: number): void {
    const n = this.count(dt, 260);
    for (let i = 0; i < n; i++) {
      const back = Math.random() * 0.05;
      this.flameParticle(
        p.x - v.x * back + rnd(r * 0.6),
        p.y - v.y * back + rnd(r * 0.6),
        p.z - v.z * back + rnd(r * 0.6),
        -v.x * 0.15 + rnd(1.4),
        -v.y * 0.15 + rnd(1.4) + 0.8,
        -v.z * 0.15 + rnd(1.4),
        r * (2.2 + Math.random() * 1.2),
        0.32 + Math.random() * 0.25,
      );
    }
    if (Math.random() < dt * 30) this.smokeParticle(p.x, p.y, p.z, 0.35);
  }

  private readonly sf = new THREE.Vector3();
  private readonly ss = new THREE.Vector3();
  private readonly su = new THREE.Vector3();

  /**
   * Alev Akımı: avuçtan rakibe doğru akan, kendi ekseninde dönen yumuşak ateş hortumu.
   * Kaynakta mavi-beyaz çekirdek, ortada sarı-turuncu gövde, uçta koyu turuncu ve duman; yanlara kıvılcım saçılır.
   * Keskin çizgi yok: tüm parçalar yumuşak, büyüyen, türbülanslı bulutlar.
   */
  flameTrail(p: THREE.Vector3, v: THREE.Vector3, r: number, age: number, lifetime: number, dt: number, seed = 0): void {
    const k = Math.min(1, age / Math.max(0.01, lifetime));
    const fwd = this.sf.copy(v).normalize();
    const side = this.ss.crossVectors(fwd, Y_UP);
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    const up = this.su.crossVectors(side, fwd).normalize();
    const speed = v.length();
    const n = this.count(dt, 260);
    for (let i = 0; i < n; i++) {
      // Sarmal: parçacık eksen etrafında dönen bir halkada doğar, teğetsel hızla dönmeye devam eder
      const a = seed * 2.39 + age * 16 + Math.random() * Math.PI * 2;
      const rr = r * (0.25 + 2.2 * k) * (0.6 + Math.random() * 0.6);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ox = (side.x * ca + up.x * sa) * rr;
      const oy = (side.y * ca + up.y * sa) * rr;
      const oz = (side.z * ca + up.z * sa) * rr;
      // Teğet (dönüş) + hafif dışa açılma + akış yönünde ilerleme
      const tx = -side.x * sa + up.x * ca;
      const ty = -side.y * sa + up.y * ca;
      const tz = -side.z * sa + up.z * ca;
      const swirl = 3.5 + k * 3;
      const flow = speed * (0.45 + Math.random() * 0.25);
      const vx = fwd.x * flow + tx * swirl + ox * 2.5;
      const vy = fwd.y * flow + ty * swirl + oy * 2.5 + 0.4;
      const vz = fwd.z * flow + tz * swirl + oz * 2.5;
      const roll = Math.random();
      let c0 = FIRE_HOT;
      let c1 = FIRE_MID;
      if (k < 0.12 ? roll < 0.55 : k < 0.3 ? roll < 0.12 : false) {
        // Mavi çekirdek: kaynağa yakın, sıcak gaz
        c0 = BLUE_HOT;
        c1 = BLUE_MID;
      } else if (k > 0.55) {
        c0 = roll < 0.5 ? FIRE_HOT : FIRE_MID;
        c1 = FIRE_END;
      }
      this.emitFire(p.x + ox, p.y + oy, p.z + oz, vx, vy, vz, {
        life: 0.22 + Math.random() * 0.2 + k * 0.15,
        size0: r * (c0 === BLUE_HOT ? 0.6 : 0.9 + k * 1.6),
        size1: r * (c0 === BLUE_HOT ? 1.2 : (2.4 + k * 3.2) * (0.8 + Math.random() * 0.5)),
        color0: c0,
        color1: c1,
        alpha: c0 === BLUE_HOT ? 0.4 : 0.26 + k * 0.1,
        drag: 2.2,
        lift: 2.2,
        turbulence: 7,
      });
    }
    // Saçılan kıvılcımlar ve korlar (yerçekimiyle düşer)
    if (Math.random() < dt * 22) {
      this.emitFire(p.x, p.y, p.z, fwd.x * speed * 0.3 + rnd(4), rnd(3) + 1.5, fwd.z * speed * 0.3 + rnd(4), {
        life: 0.5 + Math.random() * 0.4,
        size0: 0.09,
        size1: 0.03,
        color0: FIRE_HOT,
        color1: FIRE_MID,
        alpha: 1,
        drag: 0.8,
        lift: -6,
        turbulence: 3,
      });
    }
    // Uçta yükselen duman
    if (k > 0.6 && Math.random() < dt * 10) this.smokeParticle(p.x, p.y + 0.2, p.z, 0.45);
  }

  /** Alev Akımı süren avuç: mavi-beyaz çekirdek ve nişana doğru titreyen alev dilleri */
  handFlame(at: THREE.Vector3, aim: THREE.Vector3, dt: number): void {
    const d = this.sf.subVectors(aim, at);
    const len = d.length() || 1;
    d.divideScalar(len);
    const n = this.count(dt, 120);
    for (let i = 0; i < n; i++) {
      const blue = Math.random() < 0.6;
      this.emitFire(at.x + rnd(0.04), at.y + rnd(0.04), at.z + rnd(0.04), d.x * 3 + rnd(0.8), d.y * 3 + rnd(0.8) + 0.5, d.z * 3 + rnd(0.8), {
        life: 0.1 + Math.random() * 0.08,
        size0: 0.22,
        size1: 0.08,
        color0: blue ? BLUE_HOT : FIRE_HOT,
        color1: blue ? BLUE_MID : FIRE_MID,
        alpha: 0.45,
        drag: 3,
        lift: 1.5,
        turbulence: 4,
      });
    }
  }

  /** Buz saçağı: arkada parıldayan buz kristalleri ve soğuk buhar */
  icicleTrail(p: THREE.Vector3, v: THREE.Vector3, dt: number): void {
    const n = this.count(dt, 140);
    for (let i = 0; i < n; i++) {
      this.frost.emit(p.x + rnd(0.08), p.y + rnd(0.08), p.z + rnd(0.08), -v.x * 0.03 + rnd(0.4), -v.y * 0.03 + rnd(0.4) - 0.3, -v.z * 0.03 + rnd(0.4), {
        life: 0.35 + Math.random() * 0.3,
        size0: 0.14,
        size1: 0.02,
        color0: FROST_0,
        color1: FROST_1,
        alpha: 0.9,
        drag: 2,
        lift: -1.5,
      });
    }
    if (Math.random() < dt * 25) {
      this.wind.emit(p.x, p.y, p.z, rnd(0.3), rnd(0.3), rnd(0.3), { life: 0.5, size0: 0.15, size1: 0.45, color0: FROST_1, color1: WIND_1, alpha: 0.25, drag: 2 });
    }
  }

  /** Kaya: dönen toz ve küçük kırıntılar */
  rockTrail(p: THREE.Vector3, r: number, dt: number): void {
    const n = this.count(dt, 30);
    for (let i = 0; i < n; i++) {
      this.dust.emit(p.x + rnd(r), p.y + rnd(r), p.z + rnd(r), rnd(0.5), rnd(0.5), rnd(0.5), {
        life: 0.5 + Math.random() * 0.3,
        size0: r * 1.2,
        size1: r * 2.8,
        color0: DUST_0,
        color1: DUST_1,
        alpha: 0.45,
        drag: 2,
        lift: -0.5,
      });
    }
  }

  /** Hava topu: etrafında dönen beyaz girdap, arkada uzayan rüzgar */
  airTrail(p: THREE.Vector3, v: THREE.Vector3, r: number, age: number, dt: number): void {
    const n = this.count(dt, 120);
    const fwd = v.clone().normalize();
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, fwd);
    for (let i = 0; i < n; i++) {
      const a = age * 22 + Math.random() * Math.PI * 2;
      const rr = r * (0.9 + Math.random() * 0.6);
      const ox = side.x * Math.cos(a) * rr + up.x * Math.sin(a) * rr;
      const oy = side.y * Math.cos(a) * rr + up.y * Math.sin(a) * rr;
      const oz = side.z * Math.cos(a) * rr + up.z * Math.sin(a) * rr;
      this.wind.emit(p.x + ox, p.y + oy, p.z + oz, -v.x * 0.1 + ox * 3, -v.y * 0.1 + oy * 3, -v.z * 0.1 + oz * 3, {
        life: 0.3 + Math.random() * 0.2,
        size0: r * 1.4,
        size1: r * 0.4,
        color0: WIND_0,
        color1: WIND_1,
        alpha: 0.35,
        drag: 3,
      });
    }
  }

  // ================================================================ patlamalar

  private fireExplosion(at: THREE.Vector3, radius: number): void {
    const n = Math.round(90 * this.scale);
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(rnd(1), rnd(1) * 0.8 + 0.2, rnd(1)).normalize();
      const sp = radius * (2 + Math.random() * 4);
      this.flameParticle(at.x, at.y + 0.2, at.z, d.x * sp, d.y * sp + 1, d.z * sp, 0.6 + Math.random() * 0.7, 0.4 + Math.random() * 0.4, 3.5);
    }
    // Çekirdek parlaması
    for (let i = 0; i < 2; i++) this.emitFire(at.x, at.y + 0.3, at.z, 0, 1, 0, { life: 0.2, size0: radius * 1.0, size1: radius * 1.8, color0: FIRE_HOT, color1: FIRE_MID, alpha: 0.6, drag: 0 });
    // Mantar duman
    for (let i = 0; i < 30 * this.scale; i++) {
      const d = new THREE.Vector3(rnd(1), Math.random(), rnd(1)).normalize();
      this.smoke.emit(at.x + d.x * 0.5, at.y + 0.4, at.z + d.z * 0.5, d.x * radius * 1.2, 1.5 + Math.random() * 2, d.z * radius * 1.2, {
        life: 1.2 + Math.random() * 0.8,
        size0: radius * 0.6,
        size1: radius * 1.8,
        color0: SMOKE_0,
        color1: SMOKE_1,
        alpha: 0.55,
        drag: 2,
        lift: 1.2,
        turbulence: 2,
      });
    }
  }

  private windBurst(at: THREE.Vector3, radius: number): void {
    const n = Math.round(90 * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = radius * (3 + Math.random() * 2);
      this.wind.emit(at.x, at.y + 0.2 + Math.random() * 1.5, at.z, Math.cos(a) * sp, rnd(1.5), Math.sin(a) * sp, {
        life: 0.4 + Math.random() * 0.25,
        size0: 0.5,
        size1: 1.3,
        color0: WIND_0,
        color1: WIND_1,
        alpha: 0.3,
        drag: 4,
      });
    }
  }

  /**
   * Rüzgar Patlaması (Hava E): net bir dalga değil, dışa doğru savrulan bulanık hava.
   * İri, çok saydam, türbülanslı yumuşak bulutlar; güçlüde girdap yönünde döner. Halka / çizgi yok.
   */
  private gust(at: THREE.Vector3, radius: number, strong: boolean): void {
    const n = Math.round((strong ? 190 : 120) * this.scale);
    const sp0 = radius / 0.5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = 0.15 + Math.random() * Math.random() * (strong ? 2.6 : 1.9);
      const r0 = 0.3 + Math.random() * 0.6;
      const sp = sp0 * (0.55 + Math.random() * 0.6);
      const swirl = strong ? sp * 0.4 : sp * 0.12;
      this.wind.emit(at.x + Math.cos(a) * r0, at.y + h, at.z + Math.sin(a) * r0, Math.cos(a) * sp - Math.sin(a) * swirl, rnd(0.8) + 0.3, Math.sin(a) * sp + Math.cos(a) * swirl, {
        life: 0.45 + Math.random() * 0.35,
        size0: 0.7 + Math.random() * 0.5,
        size1: 2.2 + Math.random() * 1.6,
        color0: WIND_0,
        color1: WIND_1,
        alpha: 0.07 + Math.random() * 0.05,
        drag: 3.2,
        turbulence: 4,
      });
    }
    // Merkezde bir an bulanıklaşan hava (sıkışıp açılan rüzgar)
    for (let i = 0; i < 6 * this.scale; i++) {
      this.wind.emit(at.x + rnd(0.4), at.y + 0.4 + Math.random() * 1.2, at.z + rnd(0.4), rnd(1.5), 0.6, rnd(1.5), {
        life: 0.35,
        size0: 1.5,
        size1: 3.6,
        color0: WIND_0,
        color1: WIND_1,
        alpha: 0.06,
        drag: 2,
        turbulence: 2,
      });
    }
  }

  private dustBurst(at: THREE.Vector3, radius: number, count: number): void {
    const n = Math.round(count * this.scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 3) * radius;
      this.dust.emit(at.x, at.y + 0.1, at.z, Math.cos(a) * sp, 0.5 + Math.random() * 2, Math.sin(a) * sp, {
        life: 0.7 + Math.random() * 0.6,
        size0: 0.3,
        size1: 1 + radius * 0.5,
        color0: DUST_0,
        color1: DUST_1,
        alpha: 0.5,
        drag: 3,
        lift: -0.4,
      });
    }
  }

  private frostBurst(at: THREE.Vector3, count: number): void {
    for (let i = 0; i < count * this.scale; i++) {
      this.frost.emit(at.x, at.y, at.z, rnd(3), Math.random() * 3, rnd(3), { life: 0.4 + Math.random() * 0.3, size0: 0.1, size1: 0.02, color0: FROST_0, color1: FROST_1, alpha: 1, drag: 2.5, lift: -6 });
    }
    this.wind.emit(at.x, at.y, at.z, 0, 0.3, 0, { life: 0.5, size0: 0.3, size1: 1, color0: FROST_1, color1: WIND_1, alpha: 0.35, drag: 1 });
  }

  private fireBurst(at: THREE.Vector3, size: number, count: number): void {
    for (let i = 0; i < count * this.scale; i++) {
      this.flameParticle(at.x + rnd(0.2), at.y + rnd(0.2), at.z + rnd(0.2), rnd(2), 1 + Math.random() * 2, rnd(2), size, 0.3 + Math.random() * 0.2);
    }
  }

  /** Süren ateş nefesleri: ağızdan 0.4 sn boyunca akan alev */
  private readonly breaths: { e: GameEvents['fx:breath']; t: number; side: THREE.Vector3; up: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  /** Dövüşçünün ağız noktası (görsel kemik); yoksa olaydaki nokta kullanılır */
  mouthOf: ((casterId: string, out: THREE.Vector3) => boolean) | null = null;
  private readonly mouth = new THREE.Vector3();

  private breath(e: GameEvents['fx:breath']): void {
    const dir = e.direction.clone().normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    this.breaths.push({ e, t: 0, side, up, dir });
  }

  private updateBreaths(dt: number): void {
    const DUR = 0.4;
    for (let i = this.breaths.length - 1; i >= 0; i--) {
      const b = this.breaths[i];
      b.t += dt;
      if (b.t > DUR) {
        // Akış bitti: koni boyunca yükselen duman
        for (let k = 0; k < (14 + b.e.charge * 20) * this.scale; k++) {
          const f = 0.4 + Math.random() * 0.6;
          const d = b.dir.clone().addScaledVector(b.side, rnd(Math.tan(b.e.halfAngle) * f));
          this.smokeParticle(b.e.origin.x + d.x * b.e.range * f, b.e.origin.y + d.y * b.e.range * f, b.e.origin.z + d.z * b.e.range * f, 0.5 + b.e.charge * 0.5);
        }
        this.breaths.splice(i, 1);
        continue;
      }
      const e = b.e;
      const o = this.mouthOf && this.mouthOf(e.casterId, this.mouth) ? this.mouth : e.origin;
      // Akışın başında ve sonunda daha ince
      const env = Math.sin((b.t / DUR) * Math.PI);
      const n = this.count(dt, (500 + e.charge * 700) * (0.4 + 0.6 * env));
      const speed = e.range / 0.38;
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * Math.PI * 2;
        const spread = Math.tan(e.halfAngle) * Math.sqrt(Math.random()) * (0.6 + 0.4 * env);
        const d = b.dir.clone().addScaledVector(b.side, Math.cos(ang) * spread).addScaledVector(b.up, Math.sin(ang) * spread).normalize();
        const sp = speed * (0.75 + Math.random() * 0.4);
        const hot = Math.random() < 0.4;
        // Ağızda küçük ve sıcak, ilerledikçe büyüyen ve kızıllaşan alev
        this.emitFire(o.x + rnd(0.04), o.y + rnd(0.04), o.z + rnd(0.04), d.x * sp, d.y * sp + 0.4, d.z * sp, {
          life: 0.38 + Math.random() * 0.22,
          size0: 0.1,
          size1: (0.9 + Math.random() * 0.7) * (1 + e.charge * 0.8),
          color0: hot ? FIRE_HOT : FIRE_MID,
          color1: FIRE_END,
          alpha: hot ? 0.8 : 0.65,
          drag: 2.4,
          lift: 2.5,
          turbulence: 6,
        });
      }
      // Ağızda parlayan çekirdek
      if (Math.random() < dt * 40) this.emitFire(o.x, o.y, o.z, b.dir.x * 2, b.dir.y * 2, b.dir.z * 2, { life: 0.12, size0: 0.35, size1: 0.2, color0: FIRE_HOT, color1: FIRE_MID, alpha: 0.9, drag: 0 });
    }
  }

  // ================================================================ yardımcılar

  /** Ateş parçacığı: toplamalı parıltı + (mavi çekirdek ve minik kıvılcımlar hariç) altında kırmızı gövde */
  private emitFire(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: EmitOptions): void {
    this.fire.emit(x, y, z, vx, vy, vz, o);
    if (o.color0 === BLUE_HOT || (o.size0 < 0.1 && o.size1 < 0.15)) return;
    if (Math.random() > 0.7) return;
    this.fireBody.emit(x, y, z, vx, vy, vz, {
      ...o,
      life: o.life * 0.85,
      size0: o.size0 * 0.75,
      size1: o.size1 * 0.7,
      color0: FIRE_BODY_0,
      color1: FIRE_BODY_1,
      alpha: Math.min(1, (o.alpha ?? 1) * 1.1 + 0.15),
    });
  }

  private flameParticle(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, drag = 1.5, grow = 0.45): void {
    const hot = Math.random() < 0.35;
    const o: EmitOptions = {
      life,
      size0: size * (hot ? 0.8 : 1),
      size1: size * grow,
      color0: hot ? FIRE_HOT : FIRE_MID,
      color1: FIRE_END,
      alpha: hot ? 0.85 : 0.7,
      drag,
      lift: 3.5,
      turbulence: 4,
    };
    this.emitFire(x, y, z, vx, vy, vz, o);
  }

  private smokeParticle(x: number, y: number, z: number, size: number): void {
    this.smoke.emit(x + rnd(0.1), y, z + rnd(0.1), rnd(0.4), 0.8 + Math.random() * 0.6, rnd(0.4), {
      life: 1 + Math.random() * 0.6,
      size0: size * 0.6,
      size1: size * 2,
      color0: SMOKE_0,
      color1: SMOKE_1,
      alpha: 0.35,
      drag: 1,
      lift: 0.6,
      turbulence: 1.5,
    });
  }

  /** Kare hızından bağımsız parçacık sayısı (oran × dt, kesirli kısım olasılıkla) */
  private count(dt: number, rate: number): number {
    const x = rate * dt * this.scale;
    const n = Math.floor(x);
    return n + (Math.random() < x - n ? 1 : 0);
  }
}
