import * as THREE from 'three';
import type { ElementId } from '../abilities/elements';
import type { GameEvents } from '../abilities/types';
import type { EventBus } from '../core/EventBus';
import type { Combatant } from '../combat/Combatant';
import { GameConfig } from '../config/gameConfig';
import type { EffectsView } from './EffectsView';

export interface FeelFighter {
  c: Combatant;
  element: () => ElementId;
}

interface JetState {
  airJumps: number;
  dashing: boolean;
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
  private fovExtra = 0;
  private readonly lines: HTMLDivElement;
  private readonly jets = new Map<Combatant, JetState>();
  private readonly tmp = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();

  constructor(
    app: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly effects: EffectsView,
    private readonly fighters: () => FeelFighter[],
    private readonly playerPos: () => THREE.Vector3,
  ) {
    this.lines = document.createElement('div');
    this.lines.className = 'speed-lines';
    app.appendChild(this.lines);

    bus.on('combat:damage', (e) => {
      if (e.kind === 'burn') return;
      if (e.targetId === 'player') {
        this.addTrauma(0.3 + Math.min(0.4, e.amount / 60));
        this.hitStop = Math.max(this.hitStop, e.killed ? 0.12 : 0.07);
      } else if (e.sourceId === 'player') {
        this.addTrauma(0.12 + Math.min(0.2, e.amount / 120));
        this.hitStop = Math.max(this.hitStop, e.killed ? 0.1 : 0.045);
      }
    });
    bus.on('fx:explosion', (e) => this.nearby(e.point, 0.45, 14));
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
    if (this.hitStop <= 0) return 1;
    this.hitStop -= dt;
    return 0.06;
  }

  /** Kamera pozu ayarlandıktan sonra, render'dan önce çağrılır. */
  update(dt: number, camera: THREE.PerspectiveCamera, playerDashing: boolean, playerSpeed: number): void {
    // Sarsıntı
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const t = performance.now() / 1000;
      camera.position.x += (Math.sin(t * 61) + Math.sin(t * 37)) * 0.09 * s;
      camera.position.y += (Math.sin(t * 53 + 1) + Math.sin(t * 29)) * 0.09 * s;
      camera.rotation.z += Math.sin(t * 47 + 2) * 0.035 * s;
    }

    // Dash hızı: FOV + hız çizgileri
    const fast = playerDashing ? 1 : Math.max(0, (playerSpeed - GameConfig.player.runSpeed * 1.25) / GameConfig.player.runSpeed);
    this.fovExtra += (Math.min(1, fast) * 9 - this.fovExtra) * (1 - Math.exp(-10 * dt));
    const fov = GameConfig.camera.fov + this.fovExtra;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    this.lines.style.opacity = (Math.min(1, this.fovExtra / 9) * 0.8).toFixed(3);

    // Element jetleri
    for (const f of this.fighters()) {
      const ctl = f.c.controller;
      let st = this.jets.get(f.c);
      if (!st) {
        st = { airJumps: ctl.airJumpsLeft, dashing: ctl.dashing };
        this.jets.set(f.c, st);
      }
      if (f.c.alive) {
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
    }
  }
}
