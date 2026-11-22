import * as THREE from 'three';
import type { Combatant } from '../combat/Combatant';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

/** Dünya konumuna bağlı DOM öğeleri: karakter can barları ve uçan hasar sayıları. */
export class WorldOverlay {
  private readonly root: HTMLDivElement;
  private readonly bars = new Map<string, { el: HTMLDivElement; fill: HTMLDivElement }>();
  private readonly texts: FloatText[] = [];
  private readonly v = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly localId: string,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'world-overlay';
    container.appendChild(this.root);

    bus.on('combat:damage', (e) => {
      const el = document.createElement('div');
      el.className = `dmg${e.sourceId === localId ? ' mine' : ''}${e.kind === 'burn' ? ' burn' : ''}${e.killed ? ' kill' : ''}`;
      el.textContent = e.killed ? `${Math.round(e.amount)} ✖` : `${Math.round(e.amount)}`;
      this.root.appendChild(el);
      this.texts.push({ el, pos: e.point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, 0)), age: 0 });
    });
    bus.on('combat:heal', (e) => {
      const el = document.createElement('div');
      el.className = 'dmg heal';
      el.textContent = `+${Math.round(e.amount)}`;
      this.root.appendChild(el);
      this.texts.push({ el, pos: e.point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5, 0)), age: 0 });
    });
    bus.on('combat:ringout', (e) => {
      // Basit bildirim: arena dışı (Task 5'te raund mantığına bağlanacak)
      const el = document.createElement('div');
      el.className = 'dmg kill';
      el.textContent = 'ARENA DIŞI';
      this.root.appendChild(el);
      const c = this.positions.get(e.targetId);
      this.texts.push({ el, pos: c ? c.clone().setY(c.y + 2.5) : new THREE.Vector3(), age: 0 });
    });
  }

  private readonly positions = new Map<string, THREE.Vector3>();

  update(dt: number, camera: THREE.Camera, combatants: Combatant[], alpha: number, width: number, height: number): void {
    for (const c of combatants) {
      let bar = this.bars.get(c.id);
      if (c.id === this.localId) continue;
      if (!bar) {
        const el = document.createElement('div');
        el.className = 'hpbar';
        const fill = document.createElement('div');
        fill.className = 'fill';
        el.appendChild(fill);
        this.root.appendChild(el);
        bar = { el, fill };
        this.bars.set(c.id, bar);
      }
      const ctl = c.controller;
      this.v.lerpVectors(ctl.prevPosition, ctl.position, alpha);
      let p = this.positions.get(c.id);
      if (!p) this.positions.set(c.id, (p = new THREE.Vector3()));
      p.copy(this.v);
      this.v.y += c.height + 0.45;
      const visible = c.alive && this.project(this.v, camera, width, height);
      bar.el.style.display = visible ? 'block' : 'none';
      if (visible) {
        bar.el.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -50%)`;
        bar.fill.style.width = `${(c.hp / c.opts.maxHp) * 100}%`;
        bar.el.classList.toggle('low', c.hp / c.opts.maxHp < 0.35);
        bar.el.classList.toggle('chilled', c.chillStacks > 0 || c.frozenTimer > 0);
        bar.el.classList.toggle('frozen', c.frozenTimer > 0);
        bar.el.classList.toggle('burning', c.burning);
      }
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.age += dt;
      t.pos.y += dt * 1.4;
      this.v.copy(t.pos);
      const vis = this.project(this.v, camera, width, height);
      t.el.style.opacity = vis ? String(Math.max(0, 1 - t.age / 0.9)) : '0';
      t.el.style.transform = `translate(${this.v.x}px, ${this.v.y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - t.age) * 1.5})`;
      if (t.age > 0.9) {
        t.el.remove();
        this.texts.splice(i, 1);
      }
    }
  }

  /** Dünya → ekran (px). Kameranın arkasındaysa false. */
  private project(v: THREE.Vector3, camera: THREE.Camera, width: number, height: number): boolean {
    v.project(camera);
    if (v.z > 1) return false;
    v.x = (v.x * 0.5 + 0.5) * width;
    v.y = (-v.y * 0.5 + 0.5) * height;
    return true;
  }
}
