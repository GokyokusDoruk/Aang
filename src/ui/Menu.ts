import type { Difficulty, GameMode } from '../game/GameSession';

export interface MenuCallbacks {
  onStart(mode: GameMode, difficulty: Difficulty): void;
  onResume(): void;
  onRestart(): void;
  onMainMenu(): void;
}

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Kolay', normal: 'Normal', hard: 'Zor' };

/**
 * Ana menü, duraklatma ve maç sonu ekranları (masaüstü + mobil).
 * Butonlar kullanıcı hareketi sayıldığından masaüstünde pointer-lock burada istenebilir.
 */
export class Menu {
  private readonly root: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private difficulty: Difficulty = 'normal';
  visible = true;

  constructor(
    container: HTMLElement,
    private readonly touch: boolean,
    private readonly cb: MenuCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.card = document.createElement('div');
    this.card.className = 'card';
    this.root.appendChild(this.card);
    // Menüdeki dokunuşlar oyuna (joystick/bakış) geçmesin
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    container.appendChild(this.root);
    this.showMain();
  }

  /** Menü katmanının köşesine kalıcı bir öğe ekler (örn. ses düğmesi). */
  attach(el: HTMLElement): void {
    this.root.appendChild(el);
  }

  private render(html: string, bind: Record<string, () => void>): void {
    this.card.innerHTML = html;
    for (const [sel, fn] of Object.entries(bind)) {
      this.card.querySelector(sel)?.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    }
    this.root.classList.remove('hidden');
    this.visible = true;
  }

  private controls(): string {
    return this.touch
      ? `<ul class="help">
          <li>Sol yarı: hareket · Sağ yarı: bakış</li>
          <li>Üstteki çipler: element seç</li>
          <li>Sağ alt: saldırı, yetenek, zıpla, dash, kay</li>
        </ul>`
      : `<ul class="help">
          <li><b>WASD</b> hareket · <b>Fare</b> bakış · <b>Space</b> zıpla</li>
          <li><b>1-4 / Q / Tekerlek</b> element · <b>Sol / Sağ tık</b> yetenek</li>
          <li><b>Shift</b> dash · <b>C</b> kayma · <b>Esc</b> duraklat · <b>M</b> ses</li>
        </ul>`;
  }

  showMain(): void {
    const diffs = (Object.keys(DIFF_LABEL) as Difficulty[])
      .map((d) => `<button class="seg${d === this.difficulty ? ' on' : ''}" data-d="${d}">${DIFF_LABEL[d]}</button>`)
      .join('');
    this.render(
      `<h1>Element Arena</h1>
       <p class="sub">Toprak · Su/Buz · Ateş/Yıldırım · Hava</p>
       <div class="row label">Bot zorluğu</div>
       <div class="segs">${diffs}</div>
       <button class="btn primary" id="m-match">Bota Karşı Maç</button>
       <button class="btn" id="m-train">Antrenman (Kuklalar)</button>
       ${this.controls()}`,
      {
        '#m-match': () => this.cb.onStart('match', this.difficulty),
        '#m-train': () => this.cb.onStart('training', this.difficulty),
      },
    );
    this.card.querySelectorAll<HTMLButtonElement>('.seg').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.difficulty = b.dataset.d as Difficulty;
        this.showMain();
      }),
    );
  }

  showPause(): void {
    this.render(
      `<h1>Duraklatıldı</h1>
       <button class="btn primary" id="p-resume">Devam Et</button>
       <button class="btn" id="p-restart">Yeniden Başlat</button>
       <button class="btn" id="p-menu">Ana Menü</button>
       ${this.controls()}`,
      {
        '#p-resume': () => this.cb.onResume(),
        '#p-restart': () => this.cb.onRestart(),
        '#p-menu': () => this.cb.onMainMenu(),
      },
    );
  }

  showMatchEnd(won: boolean, myScore: number, botScore: number): void {
    this.render(
      `<h1 class="${won ? 'win' : 'lose'}">${won ? 'MAÇI KAZANDIN!' : 'MAÇI KAYBETTİN'}</h1>
       <p class="score">${myScore} – ${botScore}</p>
       <button class="btn primary" id="e-again">Tekrar Oyna</button>
       <button class="btn" id="e-menu">Ana Menü</button>`,
      {
        '#e-again': () => this.cb.onRestart(),
        '#e-menu': () => this.cb.onMainMenu(),
      },
    );
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.visible = false;
  }
}
