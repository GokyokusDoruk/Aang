import type { Combatant } from '../combat/Combatant';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';

/** Oyuncunun can barı, hasar kenar kızarması ve yenilgi ekranı. */
export class PlayerStatus {
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly ghost: HTMLDivElement;
  private readonly text: HTMLSpanElement;
  private readonly vignette: HTMLDivElement;
  private readonly defeat: HTMLDivElement;
  private readonly defeatTitle: HTMLDivElement;
  private readonly defeatSub: HTMLDivElement;
  private ghostRatio = 1;
  private shownHp = -1;

  constructor(
    container: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly self: Combatant,
    touch: boolean,
  ) {
    this.bar = document.createElement('div');
    this.bar.className = `player-hp${touch ? ' touch' : ''}`;
    this.ghost = document.createElement('div');
    this.ghost.className = 'ghost';
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    this.text = document.createElement('span');
    this.text.className = 'txt';
    const track = document.createElement('div');
    track.className = 'track';
    track.append(this.ghost, this.fill);
    const label = document.createElement('span');
    label.className = 'lbl';
    label.textContent = 'HP';
    this.bar.append(label, track, this.text);

    this.vignette = document.createElement('div');
    this.vignette.className = 'vignette';

    this.defeat = document.createElement('div');
    this.defeat.className = 'defeat hidden';
    this.defeatTitle = document.createElement('div');
    this.defeatTitle.className = 'title';
    this.defeatSub = document.createElement('div');
    this.defeatSub.className = 'sub';
    this.defeat.append(this.defeatTitle, this.defeatSub);

    container.append(this.vignette, this.bar, this.defeat);

    bus.on('combat:damage', (e) => {
      if (e.targetId !== self.id) return;
      this.vignette.classList.remove('flash');
      void this.vignette.offsetWidth;
      this.vignette.classList.add('flash');
    });
    bus.on('combat:death', (e) => {
      if (e.targetId !== self.id) return;
      this.defeatTitle.textContent = e.cause === 'ringout' ? 'ARENA DIŞI' : 'YENİLDİN';
      this.defeat.classList.remove('hidden');
    });
    bus.on('combat:respawn', (e) => {
      if (e.targetId === self.id) this.defeat.classList.add('hidden');
    });
  }

  update(dt: number): void {
    const c = this.self;
    const ratio = Math.max(0, c.hp / c.opts.maxHp);
    // Hasar sonrası beyaz "hayalet" bar yavaşça iner
    this.ghostRatio = Math.max(ratio, this.ghostRatio - dt * 0.6);
    if (this.ghostRatio < ratio) this.ghostRatio = ratio;
    this.fill.style.width = `${ratio * 100}%`;
    this.ghost.style.width = `${this.ghostRatio * 100}%`;
    this.bar.classList.toggle('low', ratio < 0.35);
    this.bar.classList.toggle('shield', c.spawnProtected);
    const hp = Math.ceil(c.hp);
    if (hp !== this.shownHp) {
      this.shownHp = hp;
      this.text.textContent = `${hp} / ${c.opts.maxHp}`;
    }
    if (!c.alive) this.defeatSub.textContent = `Yeniden doğuş: ${c.respawnRemaining.toFixed(1)} s`;
  }
}
