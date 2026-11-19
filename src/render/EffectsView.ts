import * as THREE from 'three';
import { ELEMENTS } from '../abilities/elements';
import type { GameEvents } from '../abilities/types';
import type { EventBus } from '../core/EventBus';

interface Fx {
  obj: THREE.Object3D;
  mats: THREE.Material[];
  life: number;
  max: number;
  tick(t: number): void; // t: 0..1
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

  constructor(
    private readonly scene: THREE.Scene,
    bus: EventBus<GameEvents>,
  ) {
    bus.on('ability:cast', (e) => this.spawnCast(e));
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
    fx.tick(0);
    this.scene.add(fx.obj);
    this.items.push(fx);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const fx = this.items[i];
      fx.life += dt;
      const t = Math.min(1, fx.life / fx.max);
      fx.tick(t);
      if (t >= 1) {
        this.scene.remove(fx.obj);
        for (const m of fx.mats) m.dispose();
        if (fx.obj instanceof THREE.Line) fx.obj.geometry.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}
