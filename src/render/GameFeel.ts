import * as THREE from 'three';
import type { ElementId } from '../abilities/elements';
import type { GameEvents } from '../abilities/types';
import type { EventBus } from '../core/EventBus';
import type { Combatant } from '../combat/Combatant';
import { GameConfig } from '../config/gameConfig';
import type { EffectsView } from './EffectsView';
import type { PostFx } from './PostFx';

export interface FeelFighter {
  c: Combatant;
  element: () => ElementId;
}

interface JetState {
  airJumps: number;
  dashing: boolean;
  grounded: boolean;
  /** Önceki adımın dikey hızı (iniş sertliği için) */
  vy: number;
  /** Son ayak tozundan beri yerde katedilen mesafe */
  stride: number;
  foot: number;
}

/**
 * Vuruş hissi (tamamen görsel / zamanlama; oyun kurallarını değiştirmez):
 * - Kamera sarsıntısı ("trauma" modeli: sarsıntı = trauma², zamanla söner)
 * - Vuruş duraksaması (hit-stop): isabet anında simülasyon çok kısa süre neredeyse durur
 * - Dash sırasında görüş açısı (FOV) genişler + ekran kenarında hız çizgileri
 * - Çift zıplama / dash anında ayaklardan element jeti (ateşte alev)
 */
export class GameFeel {
  private trauma = 0;
  private hitStop = 0;
  /** Final vuruşu ağır çekimi: kalan süre (gerçek zaman, s) */
  private slowmo = 0;
  private static readonly SLOWMO_TIME = 1.3;
  private fovExtra = 0;
  private readonly lines: HTMLDivElement;
  private readonly jets = new Map<Combatant, JetState>();
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  // --- Kamera "el" hissi (yay-sönüm): iniş çökmesi, büyü geri tepmesi, yan eğim
  private landY = 0;
  private landV = 0;
  private recoil = 0;
  private recoilV = 0;
  private roll = 0;
  private zoom = 0;
  // --- Son işlem durumları
  private aberration = 0;
  private hurt = 0;
  private lowHp = 0;
  private time = 0;

  constructor(
    private readonly app: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly effects: EffectsView,
    private readonly fighters: () => FeelFighter[],
    private readonly playerPos: () => THREE.Vector3,
    /** Yerel oyuncu (can / iniş / yan hız için) */
    private readonly player: Combatant,
    private readonly post: () => PostFx | null,
  ) {
    this.lines = document.createElement('div');
    this.lines.className = 'speed-lines';
    app.appendChild(this.lines);

    bus.on('combat:damage', (e) => {
      if (e.kind === 'burn') return;
      if (e.targetId === 'player') {
        this.addTrauma(0.3 + Math.min(0.4, e.amount / 60));
        this.hitStop = Math.max(this.hitStop, e.killed ? 0.12 : 0.07);
        this.aberration = Math.min(1, this.aberration + 0.45 + e.amount / 40);
        this.hurt = Math.min(1, this.hurt + 0.35 + e.amount / 50);
      } else if (e.sourceId === 'player') {
        this.addTrauma(0.12 + Math.min(0.2, e.amount / 120));
        this.hitStop = Math.max(this.hitStop, e.killed ? 0.1 : 0.045);
        this.aberration = Math.min(1, this.aberration + 0.18 + e.amount / 100);
      }
    });
    // Final vuruşu: oyuncunun ya da botun yenildiği (veya oyuncunun birini yendiği) an ağır çekim
    bus.on('combat:death', (e) => {
      if (e.targetId === 'player' || e.targetId === 'bot' || e.killerId === 'player') {
        this.slowmo = GameFeel.SLOWMO_TIME;
        this.addTrauma(0.35);
        this.app.classList.remove('finisher');
        void this.app.offsetWidth;
        this.app.classList.add('finisher');
      }
    });
    // Büyü çıktığında kamerada küçük bir geri tepme (ağır büyülerde daha belirgin)
    bus.on('ability:cast', (e) => {
      if (e.casterId !== 'player') return;
      this.recoilV += e.ability.slot === 'primary' ? 0.35 : 0.7;
    });
    bus.on('ability:chargedEnd', (e) => {
      if (e.casterId === 'player' && !e.cancelled && e.charged.kind !== 'channel') this.recoilV += 0.9;
    });
    bus.on('fx:explosion', (e) => {
      this.nearby(e.point, 0.45, 14);
      if (e.point.distanceTo(this.playerPos()) < 14) this.aberration = Math.min(1, this.aberration + 0.35);
    });
    bus.on('crate:broken', (e) => this.nearby(e.center, 0.2, 10));
    bus.on('wall:destroyed', (e) => e.columns[0] && this.nearby(e.columns[0], 0.25, 12));
    bus.on('fx:burst', (e) => e.element === 'earth' && e.size >= 0.5 && this.nearby(e.point, 0.08, 8));
    bus.on('fx:lightning', (e) => this.nearby(e.from, 0.15, 6));
  }

  private addTrauma(v: number): void {
    this.trauma = Math.min(1, this.trauma + v);
  }

  private nearby(at: THREE.Vector3, amount: number, radius: number): void {
    const d = at.distanceTo(this.playerPos());
    if (d < radius) this.addTrauma(amount * (1 - d / radius));
  }

  /** Simülasyon zaman çarpanı (hit-stop sırasında çok küçük). */
  simScale(dt: number): number {
    let s = 1;
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      // İlk %70 çok yavaş (0.22), sonra yumuşakça normale döner
      const k = 1 - Math.max(0, this.slowmo) / GameFeel.SLOWMO_TIME;
      s = k < 0.7 ? 0.22 : 0.22 + ((k - 0.7) / 0.3) * 0.78;
    }
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      s = Math.min(s, 0.06);
    }
    return s;
  }

  /** Kamera pozu ayarlandıktan sonra, render'dan önce çağrılır. */
  update(dt: number, camera: THREE.PerspectiveCamera, playerDashing: boolean, playerSpeed: number): void {
    this.time += dt;
    const ctl = this.player.controller;

    // Sarsıntı: yumuşak gürültü (iç içe sinüsler), sarsıntıyla birlikte hafif yuvarlanma
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = this.time;
      camera.position.x += (Math.sin(t * 61) + Math.sin(t * 37 + Math.sin(t * 7))) * 0.09 * s;
      camera.position.y += (Math.sin(t * 53 + 1) + Math.sin(t * 29)) * 0.09 * s;
      camera.rotation.z += (Math.sin(t * 47 + 2) + 0.5 * Math.sin(t * 13)) * 0.03 * s;
    }

    // İniş çökmesi (yay): sert inişte kamera aşağı oturur, yaylanarak toparlanır
    const spring = (x: number, v: number, k: number, c: number): [number, number] => {
      const h = Math.min(dt, 1 / 30);
      v += (-k * x - c * v) * h;
      return [x + v * h, v];
    };
    [this.landY, this.landV] = spring(this.landY, this.landV, 180, 16);
    camera.position.y -= this.landY;
    // Büyü geri tepmesi: nişan hafif yukarı seker, yumuşakça döner
    [this.recoil, this.recoilV] = spring(this.recoil, this.recoilV, 260, 22);
    camera.rotation.x += this.recoil * 0.025;

    // Yana koşarken kamera akışa doğru çok hafif yatar (sinematik his)
    const right = Math.cos(camera.rotation.y) * ctl.velocity.x - Math.sin(camera.rotation.y) * ctl.velocity.z;
    const rollTarget = this.player.alive ? THREE.MathUtils.clamp(-right / GameConfig.player.runSpeed, -1.4, 1.4) * 0.018 : 0;
    this.roll += (rollTarget - this.roll) * (1 - Math.exp(-5 * dt));
    camera.rotation.z += this.roll;

    // Dash hızı: FOV + hız çizgileri; final vuruşu ağır çekiminde yakınlaşma
    const fast = playerDashing ? 1 : Math.max(0, (playerSpeed - GameConfig.player.runSpeed * 1.25) / GameConfig.player.runSpeed);
    this.fovExtra += (Math.min(1, fast) * 9 - this.fovExtra) * (1 - Math.exp(-10 * dt));
    const slowK = this.slowmo > 0 ? Math.min(1, this.slowmo / (GameFeel.SLOWMO_TIME * 0.35)) : 0;
    this.zoom += (slowK * -9 - this.zoom) * (1 - Math.exp(-6 * dt));
    const fov = GameConfig.camera.fov + this.fovExtra + this.zoom;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    this.lines.style.opacity = (Math.min(1, this.fovExtra / 9) * 0.8).toFixed(3);

    // Son işlem: sapma ve hasar parlaması söner; düşük can yavaşça devreye girer
    this.aberration = Math.max(0, this.aberration - dt * 2.4);
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    const hpFrac = this.player.hp / this.player.opts.maxHp;
    const lowTarget = this.player.alive && hpFrac < 0.35 ? 1 - hpFrac / 0.35 : 0;
    this.lowHp += (lowTarget * 0.8 + (lowTarget > 0 ? 0.2 : 0) - this.lowHp) * (1 - Math.exp(-3 * dt));
    const post = this.post();
    if (post) {
      post.state.aberration = Math.min(1, this.aberration + s * 0.5);
      post.state.radial = Math.min(1, this.fovExtra / 9);
      post.state.slowmo = slowK;
      post.state.lowHp = this.lowHp;
      post.state.hurt = this.hurt;
    }

    // Element jetleri
    for (const f of this.fighters()) {
      const ctl = f.c.controller;
      let st = this.jets.get(f.c);
      if (!st) {
        st = { airJumps: ctl.airJumpsLeft, dashing: ctl.dashing, grounded: ctl.grounded, vy: 0, stride: 0, foot: 1 };
        this.jets.set(f.c, st);
      }
      if (f.c.alive) {
        // İniş: toz halkası (+ yerel oyuncuda kamera çökmesi)
        if (ctl.grounded && !st.grounded && st.vy < -5) {
          const hard = Math.min(1, (-st.vy - 5) / 12);
          this.effects.landDust(ctl.position, 0.6 + hard * 1.1);
          if (f.c === this.player) {
            this.landV += 0.9 + hard * 2.6;
            if (hard > 0.6) this.addTrauma(0.12 * hard);
          }
        }
        // Koşarken ayak tozu (adım başına küçük puf, iki ayak arasında değişir)
        const sp = Math.hypot(ctl.velocity.x, ctl.velocity.z);
        if (ctl.grounded && sp > GameConfig.player.runSpeed * 0.55) {
          st.stride += sp * dt;
          if (st.stride > 1.5) {
            st.stride = 0;
            st.foot = -st.foot;
            const inv = 1 / sp;
            this.tmp.set(ctl.position.x - ctl.velocity.z * inv * 0.14 * st.foot, ctl.position.y + 0.04, ctl.position.z + ctl.velocity.x * inv * 0.14 * st.foot);
            this.effects.footDust(this.tmp, sp / GameConfig.player.runSpeed);
          }
        } else st.stride = 0.9;
        const airJump = !ctl.grounded && ctl.airJumpsLeft < st.airJumps;
        const dashStart = ctl.dashing && !st.dashing;
        if (airJump || dashStart) {
          this.tmp.copy(ctl.position).setY(ctl.position.y + 0.15);
          if (airJump) this.dir.set(0, -1, 0);
          else this.dir.set(-ctl.velocity.x, 0, -ctl.velocity.z).normalize().setY(-0.2);
          this.effects.jet(this.tmp, this.dir, f.element());
        }
      }
      st.airJumps = ctl.airJumpsLeft;
      st.dashing = ctl.dashing;
      st.grounded = ctl.grounded;
      st.vy = ctl.velocity.y;
    }
  }
}
