import type { Combatant } from '../combat/Combatant';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { RoundManager } from '../game/RoundManager';
import { GameConfig } from '../config/gameConfig';

const REASON: Record<string, string> = { hp: '', ringout: 'Arena dışı!', time: 'Süre doldu' };

/** Maç göstergeleri: skor, raund, süre, rakip can barı ve ortadaki duyurular (geri sayım, kazanan). */
export class MatchHud {
  private readonly root: HTMLDivElement;
  private readonly myDots: HTMLElement;
  private readonly theirDots: HTMLElement;
  private readonly clock: HTMLElement;
  private shownClock = '';
  private readonly info: HTMLDivElement;
  private readonly botFill: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly bannerSub: HTMLDivElement;
  private bannerTimer = 0;
  private lastCount = -1;

  constructor(
    container: HTMLElement,
    bus: EventBus<GameEvents>,
    private readonly round: RoundManager,
    private readonly bot: Combatant,
    touch: boolean,
  ) {
    this.root = document.createElement('div');
    this.root.className = `match-hud hidden${touch ? ' touch' : ''}`;
    this.root.innerHTML = `
      <div class="top">
        <div class="score">
          <span class="side me"><b>SEN</b><span class="dots"></span></span>
          <span class="clock"></span>
          <span class="side them"><span class="dots"></span><b>BOT</b></span>
        </div>
        <div class="info"></div>
        <div class="bothp"><span>BOT</span><div class="bar"><div class="fill"></div></div></div>
      </div>
      <div class="banner"><div class="big"></div><div class="small"></div></div>`;
    container.appendChild(this.root);
    this.myDots = this.root.querySelector('.me .dots')!;
    this.theirDots = this.root.querySelector('.them .dots')!;
    this.clock = this.root.querySelector('.clock')!;
    this.setDots(0, 0);
    this.info = this.root.querySelector('.info')!;
    this.botFill = this.root.querySelector('.bothp .fill')!;
    this.banner = this.root.querySelector('.banner .big')!;
    this.bannerSub = this.root.querySelector('.banner .small')!;

    bus.on('round:phase', (e) => {
      const me = e.scores.player ?? 0;
      const them = e.scores.bot ?? 0;
      this.setDots(me, them);
      if (e.phase === 'fight') this.showBanner('SAVAŞ!', '', 0.8);
      else if (e.phase === 'roundEnd') {
        const title = e.winnerId === 'player' ? 'RAUNDU KAZANDIN' : e.winnerId === 'bot' ? 'RAUNDU KAYBETTİN' : 'BERABERE';
        this.showBanner(title, REASON[e.reason ?? ''] ?? '', 99);
      } else if (e.phase === 'countdown') {
        this.lastCount = -1;
      } else if (e.phase === 'matchEnd' || e.phase === 'idle') {
        this.showBanner('', '', 0);
      }
    });
  }

  /** Kazanılan raundlar dolu nokta: ●●○ | ○●● */
  private setDots(me: number, them: number): void {
    const n = GameConfig.match.roundsToWin;
    const dots = (won: number, rev: boolean) => {
      const arr = Array.from({ length: n }, (_, i) => `<i class="${i < won ? 'won' : ''}"></i>`);
      return (rev ? arr.reverse() : arr).join('');
    };
    this.myDots.innerHTML = dots(me, false);
    this.theirDots.innerHTML = dots(them, true);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  private showBanner(big: string, small: string, time: number): void {
    this.banner.textContent = big;
    this.bannerSub.textContent = small;
    this.bannerTimer = time;
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth;
    if (big) this.banner.classList.add('pop');
  }

  update(dt: number): void {
    const r = this.round;
    if (r.phase === 'countdown') {
      const n = Math.ceil(r.timer);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.showBanner(String(n), `Raund ${r.round}`, 99);
      }
    } else if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.showBanner('', '', 0);
    }
    const t = Math.ceil(r.timeLeft);
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (clock !== this.shownClock) {
      this.shownClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('urgent', r.phase === 'fight' && t <= 10);
      this.info.textContent = `Raund ${r.round}`;
    }
    this.botFill.style.width = `${Math.max(0, this.bot.hp / this.bot.opts.maxHp) * 100}%`;
  }
}
