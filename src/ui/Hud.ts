import type { MoveState } from '../game/PlayerController';

export interface HudInfo {
  fps: number;
  speed: number;
  state: MoveState;
  /** 0 = hazır, 1 = yeni kullanıldı */
  dashCd: number;
  slideCd: number;
  airJumps: number;
  airDashes: number;
  pos: { x: number; y: number; z: number };
}

const STATE_LABEL: Record<MoveState, string> = {
  grounded: 'Yerde',
  airborne: 'Havada',
  sliding: 'Kayma',
  dashing: 'Dash',
  gliding: 'Buz Kayması',
  floating: 'Rüzgar Süzülmesi',
};

/** DOM tabanlı HUD: crosshair, debug paneli, cooldown göstergeleri, başlangıç ekranı. */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private readonly pills = new Map<string, { el: HTMLDivElement; fill: HTMLDivElement }>();
  private lastText = 0;

  constructor(container: HTMLElement, opts: { touch: boolean; debug: boolean }) {
    this.root = document.createElement('div');
    this.root.className = `hud${opts.touch ? ' touch' : ''}`;
    this.root.innerHTML = `<div class="crosshair"></div>`;

    this.debug = document.createElement('div');
    this.debug.className = 'debug';
    if (opts.debug) this.root.appendChild(this.debug);

    const cds = document.createElement('div');
    cds.className = 'cooldowns';
    for (const [key, label] of [
      ['dash', 'Dash'],
      ['slide', 'Kayma'],
    ]) {
      const el = document.createElement('div');
      el.className = 'pill';
      const fill = document.createElement('div');
      fill.className = 'fill';
      el.appendChild(fill);
      el.appendChild(document.createTextNode(label));
      cds.appendChild(el);
      this.pills.set(key, { el, fill });
    }
    this.root.appendChild(cds);

    container.appendChild(this.root);
  }

  /** Kendi saldırın bir hedefe isabet ettiğinde crosshair işareti. */
  hitMarker(kill: boolean): void {
    const ch = this.root.querySelector('.crosshair') as HTMLElement | null;
    if (!ch) return;
    ch.classList.remove('hit', 'kill');
    void ch.offsetWidth;
    ch.classList.add(kill ? 'kill' : 'hit');
  }

  update(info: HudInfo, now: number): void {
    this.setPill('dash', info.dashCd);
    this.setPill('slide', info.slideCd);

    if (now - this.lastText < 100) return;
    this.lastText = now;
    this.debug.textContent =
      `FPS   ${info.fps.toFixed(0)}\n` +
      `Durum ${STATE_LABEL[info.state]}\n` +
      `Hız   ${info.speed.toFixed(1)} m/s\n` +
      `Hava  zıpla ${info.airJumps} · dash ${info.airDashes}\n` +
      `Poz   ${info.pos.x.toFixed(1)} ${info.pos.y.toFixed(1)} ${info.pos.z.toFixed(1)}`;
  }

  private setPill(key: string, cd: number): void {
    const p = this.pills.get(key);
    if (!p) return;
    p.fill.style.width = `${(1 - cd) * 100}%`;
    p.el.classList.toggle('ready', cd <= 0);
  }
}
