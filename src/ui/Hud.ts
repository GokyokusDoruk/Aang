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
  private readonly overlay: HTMLDivElement | null;
  private readonly pills = new Map<string, { el: HTMLDivElement; fill: HTMLDivElement }>();
  private lastText = 0;

  constructor(container: HTMLElement, opts: { touch: boolean; debug: boolean; onStart?: () => void }) {
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

    if (!opts.touch) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'overlay';
      this.overlay.innerHTML = `
        <div class="card">
          <h1>Element Arena</h1>
          <p class="sub">Task 4 · Su/Buz Kayma &amp; Hava/Rüzgar</p>
          <p class="cta">Oynamak için tıkla</p>
          <ul>
            <li><b>WASD</b> hareket · <b>Fare</b> bakış</li>
            <li><b>1-4</b> / <b>Q</b> / <b>Tekerlek</b> element seç</li>
            <li><b>Sol tık</b> ana yetenek · <b>Sağ tık</b> ikincil</li>
            <li><b>Space</b> zıpla (havada 2. zıplama)</li>
            <li><b>Shift</b> dash (havada 1 kez)</li>
            <li><b>C</b> kayma · <b>R</b> yeniden doğ</li>
            <li><b>Esc</b> fareyi bırak</li>
          </ul>
        </div>`;
      this.overlay.addEventListener('click', () => opts.onStart?.());
      this.root.appendChild(this.overlay);
    } else {
      this.overlay = null;
    }

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

  setPointerLocked(locked: boolean): void {
    this.overlay?.classList.toggle('hidden', locked);
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
