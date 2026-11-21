import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { ElementId } from '../abilities/elements';
import type { RoundManager } from '../game/RoundManager';
import type { MoveState } from '../game/PlayerController';

/**
 * Tamamen sentezlenen ses efektleri (Web Audio, dış ses dosyası yok).
 * Olay yolundan dinler; dünya olayları kameraya göre sağ/sol pan ve uzaklıkla kısılır.
 * Tarayıcı kuralı gereği ses bağlamı ilk tıklama / tuşta açılır. M tuşu sesi açar/kapatır.
 */
export class SoundSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private readonly last = new Map<string, number>();
  private readonly camPos = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3(1, 0, 0);
  private muted = localStorage.getItem('ea-muted') === '1';
  private readonly listeners = new Set<(muted: boolean) => void>();
  private lastCount = -1;
  private lastMove: MoveState | null = null;
  private lastAirJumps = -1;

  constructor(bus: EventBus<GameEvents>, private readonly playerId = 'player') {
    const unlock = () => this.ensure();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', (e) => {
      unlock();
      if (e.code === 'KeyM' && !e.repeat) this.setMuted(!this.muted);
    }, { capture: true });
    // Menü / arayüz butonları
    window.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('button, .chip')) this.ui();
    }, { capture: true });
    this.bind(bus);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  onMuteChange(fn: (muted: boolean) => void): void {
    this.listeners.add(fn);
    fn(this.muted);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem('ea-muted', m ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
    for (const fn of this.listeners) fn(m);
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Her karede: dinleyici (kamera) konumu, hareket sesleri ve geri sayım bip'leri. */
  update(camera: THREE.Camera, move: { state: MoveState; airJumpsLeft: number } | null, round: RoundManager | null): void {
    camera.getWorldPosition(this.camPos);
    this.camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    if (move) {
      if (move.state !== this.lastMove) {
        if (move.state === 'dashing') this.whoosh(0.22, 500, 1800, 0.35);
        else if (move.state === 'sliding') this.slide();
        else if (move.state === 'grounded' && this.lastMove === 'airborne') this.land();
        else if (move.state === 'airborne' && this.lastMove === 'grounded') this.whoosh(0.16, 250, 800, 0.2);
        this.lastMove = move.state;
      }
      if (this.lastAirJumps >= 0 && move.airJumpsLeft < this.lastAirJumps) this.whoosh(0.2, 300, 1200, 0.3);
      this.lastAirJumps = move.airJumpsLeft;
    }
    if (round) {
      if (round.phase === 'countdown') {
        const n = Math.ceil(round.timer);
        if (n !== this.lastCount && n > 0) {
          this.lastCount = n;
          this.beep(660, 0.12, 0.25);
        }
      } else this.lastCount = -1;
    }
  }

  // ------------------------------------------------------------------ olaylar
  private bind(bus: EventBus<GameEvents>): void {
    const me = this.playerId;
    bus.on('ability:cast', (e) => this.cast(e.ability.element, e.ability.id, e.origin));
    bus.on('ability:denied', (e) => {
      if (e.casterId === me && e.reason !== 'switching') this.denied();
    });
    bus.on('element:changed', (e) => {
      if (e.casterId === me) this.blip(e.element);
    });
    bus.on('projectile:impact', (e) => this.impact(e.element, e.point, e.hitCombatant));
    bus.on('combat:damage', (e) => {
      if (e.kind === 'burn') return this.sizzle(e.point, e.targetId === me);
      if (e.targetId === me) this.hurt(e.killed);
      else if (e.sourceId === me) this.hitConfirm(e.killed);
    });
    bus.on('combat:ringout', (e) => this.fallOut(e.targetId === me));
    bus.on('wall:spawn', (e) => e.element === 'earth' && this.rumble(0.55, 0.5));
    bus.on('wall:hit', (e) => this.knock(e.point, 380, 0.35));
    bus.on('wall:destroyed', (e) => (e.element === 'water' ? this.shatter(e.columns[0] ?? null) : this.crumble(e.columns[0] ?? null, 0.8)));
    bus.on('crate:hit', (e) => this.knock(e.point, 900, 0.3));
    bus.on('crate:broken', (e) => this.crateBreak(e.center));
    bus.on('fx:explosion', (e) => this.boom(e.point, e.radius));
    bus.on('fx:lightning', (e) => this.thunder(e.from));
    bus.on('projectile:deflect', () => this.ping());
    bus.on('combat:frozen', (e) => this.freeze(e.point));
    bus.on('combat:downed', (e) => this.thud(e.point));
    bus.on('ability:chargedStart', (e) => this.chargeUp(e.ability.element, e.casterId === me));
    bus.on('round:phase', (e) => {
      if (e.phase === 'fight') {
        this.beep(990, 0.1, 0.3);
        this.beep(1320, 0.25, 0.3, 0.1);
      } else if (e.phase === 'roundEnd') {
        if (e.winnerId === me) this.jingle([523, 659, 784, 1047], 0.09);
        else if (e.winnerId) this.jingle([392, 330, 262], 0.14, 'triangle');
        else this.jingle([440, 440], 0.12, 'triangle');
      } else if (e.phase === 'matchEnd') {
        if (e.winnerId === me) this.jingle([523, 659, 784, 1047, 784, 1047], 0.11);
        else this.jingle([392, 370, 330, 262], 0.2, 'triangle');
      }
    });
  }

  // ------------------------------------------------------------------ yapı taşları
  private gate(key: string, ms: number): boolean {
    const now = performance.now();
    if (now - (this.last.get(key) ?? -1e9) < ms) return false;
    this.last.set(key, now);
    return true;
  }

  /** Dünya noktası → çıkış düğümü (pan + uzaklık). Çok uzaksa null. */
  private out(at: THREE.Vector3 | null, gain: number): AudioNode | null {
    const ctx = this.ensure();
    if (!ctx || this.muted) return null;
    const g = ctx.createGain();
    let vol = gain;
    let pan = 0;
    if (at) {
      const d = at.distanceTo(this.camPos);
      vol *= 1 / (1 + Math.max(0, d - 4) / 10);
      if (vol < 0.02) return null;
      const dir = at.clone().sub(this.camPos).normalize();
      pan = THREE.MathUtils.clamp(dir.dot(this.camRight), -1, 1) * 0.8;
    }
    g.gain.value = vol;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  private env(g: GainNode, t0: number, peak: number, attack: number, dur: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  private noiseHit(
    dest: AudioNode,
    o: { type: BiquadFilterType; f0: number; f1: number; dur: number; gain: number; q?: number; attack?: number; delay?: number },
  ): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const g = ctx.createGain();
    this.env(g, t0, o.gain, o.attack ?? 0.005, o.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + o.dur + 0.05);
  }

  private tone(
    dest: AudioNode,
    o: { type: OscillatorType; f0: number; f1: number; dur: number; gain: number; attack?: number; delay?: number },
  ): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const g = ctx.createGain();
    this.env(g, t0, o.gain, o.attack ?? 0.005, o.dur);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  // ------------------------------------------------------------------ sesler
  private cast(el: ElementId, id: string, at: THREE.Vector3): void {
    if (!this.gate(`cast:${id}`, 40)) return;
    const o = this.out(at, 1);
    if (!o) return;
    switch (id) {
      case 'earthRock':
        this.noiseHit(o, { type: 'lowpass', f0: 700, f1: 90, dur: 0.28, gain: 0.9 });
        this.tone(o, { type: 'sine', f0: 120, f1: 45, dur: 0.25, gain: 0.7 });
        this.noiseHit(o, { type: 'bandpass', f0: 1800, f1: 900, dur: 0.12, gain: 0.25, q: 3, delay: 0.03 });
        return;
      case 'earthWall':
        this.noiseHit(o, { type: 'lowpass', f0: 500, f1: 120, dur: 0.6, gain: 0.8, attack: 0.04 });
        this.tone(o, { type: 'sine', f0: 70, f1: 40, dur: 0.6, gain: 0.6, attack: 0.03 });
        return;
      case 'fireBall':
        this.noiseHit(o, { type: 'bandpass', f0: 500, f1: 2200, dur: 0.35, gain: 0.8, q: 0.8, attack: 0.03 });
        this.noiseHit(o, { type: 'lowpass', f0: 400, f1: 150, dur: 0.3, gain: 0.5 });
        return;
      case 'lightningLine':
        this.noiseHit(o, { type: 'highpass', f0: 3000, f1: 1200, dur: 0.3, gain: 0.7 });
        this.tone(o, { type: 'sawtooth', f0: 1400, f1: 120, dur: 0.22, gain: 0.25 });
        this.tone(o, { type: 'square', f0: 90, f1: 60, dur: 0.18, gain: 0.15 });
        return;
      case 'waterShard':
        this.noiseHit(o, { type: 'bandpass', f0: 2400, f1: 700, dur: 0.25, gain: 0.6, q: 2 });
        this.tone(o, { type: 'sine', f0: 900, f1: 380, dur: 0.15, gain: 0.3 });
        return;
      case 'iceGlide':
        this.tone(o, { type: 'triangle', f0: 1900, f1: 2700, dur: 0.35, gain: 0.18 });
        this.tone(o, { type: 'triangle', f0: 2850, f1: 3600, dur: 0.3, gain: 0.12, delay: 0.05 });
        this.noiseHit(o, { type: 'highpass', f0: 5000, f1: 3000, dur: 0.4, gain: 0.25 });
        return;
      case 'iceWall':
        this.noiseHit(o, { type: 'highpass', f0: 4200, f1: 1800, dur: 0.3, gain: 0.55, attack: 0.02 });
        this.tone(o, { type: 'triangle', f0: 900, f1: 1800, dur: 0.18, gain: 0.25 });
        this.noiseHit(o, { type: 'bandpass', f0: 2400, f1: 1400, dur: 0.12, gain: 0.35, q: 4, delay: 0.06 });
        return;
      case 'airShockwave':
        this.noiseHit(o, { type: 'bandpass', f0: 250, f1: 1600, dur: 0.45, gain: 0.9, q: 1.2, attack: 0.04 });
        this.tone(o, { type: 'sine', f0: 90, f1: 50, dur: 0.3, gain: 0.5 });
        return;
      case 'airLeap':
        this.noiseHit(o, { type: 'bandpass', f0: 300, f1: 2000, dur: 0.4, gain: 0.7, q: 1.5, attack: 0.05 });
        return;
    }
    // Bilinmeyen yetenek: elemente göre genel ses
    const f = { earth: 200, water: 1200, fire: 900, air: 700 }[el];
    this.noiseHit(o, { type: 'bandpass', f0: f, f1: f * 1.8, dur: 0.3, gain: 0.6 });
  }

  private impact(el: ElementId, at: THREE.Vector3, hit: boolean): void {
    if (!this.gate(`imp:${el}`, 35)) return;
    const o = this.out(at, hit ? 0.9 : 0.6);
    if (!o) return;
    if (el === 'earth') {
      this.noiseHit(o, { type: 'lowpass', f0: 1200, f1: 100, dur: 0.3, gain: 0.9 });
      this.tone(o, { type: 'sine', f0: 140, f1: 50, dur: 0.2, gain: 0.6 });
    } else if (el === 'water') {
      this.noiseHit(o, { type: 'bandpass', f0: 1800, f1: 500, dur: 0.3, gain: 0.7, q: 1.5 });
      this.tone(o, { type: 'sine', f0: 700, f1: 1400, dur: 0.08, gain: 0.2, delay: 0.02 });
    } else if (el === 'fire') {
      this.noiseHit(o, { type: 'lowpass', f0: 2500, f1: 200, dur: 0.35, gain: 0.8 });
    } else {
      this.noiseHit(o, { type: 'bandpass', f0: 1500, f1: 300, dur: 0.3, gain: 0.6, q: 1 });
    }
  }

  private hurt(killed: boolean): void {
    if (!this.gate('hurt', 60)) return;
    const o = this.out(null, 0.8);
    if (!o) return;
    this.tone(o, { type: 'sine', f0: 180, f1: 60, dur: 0.22, gain: 0.8 });
    this.noiseHit(o, { type: 'lowpass', f0: 900, f1: 150, dur: 0.18, gain: 0.6 });
    if (killed) this.tone(o, { type: 'triangle', f0: 300, f1: 70, dur: 0.8, gain: 0.4, delay: 0.08 });
  }

  /** Rakibe isabet: kısa, tiz "tık" (oyuncuya geri bildirim). */
  private hitConfirm(killed: boolean): void {
    if (!this.gate('hitc', 50)) return;
    const o = this.out(null, 0.5);
    if (!o) return;
    this.tone(o, { type: 'square', f0: 1700, f1: 1500, dur: 0.06, gain: 0.25 });
    if (killed) {
      this.tone(o, { type: 'square', f0: 1300, f1: 1300, dur: 0.08, gain: 0.2, delay: 0.07 });
      this.tone(o, { type: 'square', f0: 2000, f1: 2000, dur: 0.14, gain: 0.2, delay: 0.14 });
    }
  }

  private fallOut(self: boolean): void {
    const o = this.out(null, self ? 0.7 : 0.4);
    if (!o) return;
    this.tone(o, { type: 'sine', f0: 600, f1: 80, dur: 0.7, gain: 0.5 });
    this.noiseHit(o, { type: 'bandpass', f0: 1200, f1: 200, dur: 0.6, gain: 0.3 });
  }

  private rumble(dur: number, gain: number): void {
    if (!this.gate('rumble', 80)) return;
    const o = this.out(null, gain);
    if (!o) return;
    this.noiseHit(o, { type: 'lowpass', f0: 260, f1: 90, dur, gain: 1, attack: 0.06 });
  }

  private knock(at: THREE.Vector3, f: number, gain: number): void {
    if (!this.gate(`knock${f}`, 40)) return;
    const o = this.out(at, gain);
    if (!o) return;
    this.noiseHit(o, { type: 'bandpass', f0: f, f1: f * 0.7, dur: 0.12, gain: 1, q: 4 });
    this.tone(o, { type: 'sine', f0: f * 0.25, f1: f * 0.15, dur: 0.1, gain: 0.5 });
  }

  private crumble(at: THREE.Vector3 | null, gain: number): void {
    const o = this.out(at, gain);
    if (!o) return;
    this.noiseHit(o, { type: 'lowpass', f0: 1500, f1: 100, dur: 0.7, gain: 0.9 });
    for (let i = 0; i < 4; i++) this.noiseHit(o, { type: 'bandpass', f0: 500 + Math.random() * 500, f1: 300, dur: 0.1, gain: 0.5, q: 3, delay: 0.05 + i * 0.07 });
  }

  /** Buz kırılması: cam gibi çınlayan parçalar */
  private shatter(at: THREE.Vector3 | null): void {
    const o = this.out(at, 0.9);
    if (!o) return;
    this.noiseHit(o, { type: 'highpass', f0: 6000, f1: 2500, dur: 0.45, gain: 0.7 });
    for (let i = 0; i < 5; i++)
      this.tone(o, { type: 'triangle', f0: 2000 + Math.random() * 2500, f1: 1800, dur: 0.15, gain: 0.15, delay: 0.02 + i * 0.045 });
  }

  private crateBreak(at: THREE.Vector3): void {
    const o = this.out(at, 0.8);
    if (!o) return;
    this.noiseHit(o, { type: 'bandpass', f0: 900, f1: 500, dur: 0.25, gain: 0.9, q: 2 });
    for (let i = 0; i < 3; i++) this.noiseHit(o, { type: 'bandpass', f0: 1100 + i * 250, f1: 700, dur: 0.08, gain: 0.6, q: 5, delay: 0.04 + i * 0.05 });
  }

  private boom(at: THREE.Vector3, radius: number): void {
    if (!this.gate('boom', 50)) return;
    const o = this.out(at, Math.min(1.2, 0.6 + radius * 0.15));
    if (!o) return;
    this.noiseHit(o, { type: 'lowpass', f0: 1600, f1: 60, dur: 0.8, gain: 1 });
    this.tone(o, { type: 'sine', f0: 90, f1: 35, dur: 0.6, gain: 0.8 });
  }

  private thunder(at: THREE.Vector3): void {
    const o = this.out(at, 0.8);
    if (!o) return;
    this.noiseHit(o, { type: 'highpass', f0: 4000, f1: 1500, dur: 0.12, gain: 0.8 });
    this.noiseHit(o, { type: 'lowpass', f0: 800, f1: 60, dur: 0.9, gain: 0.7, delay: 0.05, attack: 0.02 });
  }

  /** Havadan yere düşüş: tok gümleme */
  private thud(at: THREE.Vector3): void {
    const o = this.out(at, 1);
    if (!o) return;
    this.tone(o, { type: 'sine', f0: 120, f1: 45, dur: 0.3, gain: 0.7 });
    this.noiseHit(o, { type: 'lowpass', f0: 900, f1: 120, dur: 0.25, gain: 0.6 });
  }

  /** Yanma tiki: kısa cızırtı */
  private sizzle(at: THREE.Vector3, mine: boolean): void {
    const o = this.out(mine ? null : at, mine ? 0.5 : 0.4);
    if (!o) return;
    this.noiseHit(o, { type: 'highpass', f0: 3000, f1: 1500, dur: 0.22, gain: 0.35 });
  }

  /** Uzun basış başladı: elemente göre yükselen güç sesi */
  private chargeUp(el: ElementId, mine: boolean): void {
    const o = this.out(null, mine ? 0.7 : 0.35);
    if (!o) return;
    const f0 = el === 'fire' ? 180 : el === 'water' ? 600 : el === 'air' ? 400 : 120;
    this.tone(o, { type: 'sawtooth', f0, f1: f0 * 3, dur: 0.45, gain: 0.12, attack: 0.05 });
    this.noiseHit(o, { type: 'bandpass', f0: f0 * 4, f1: f0 * 10, dur: 0.4, gain: 0.25, q: 2, attack: 0.08 });
  }

  /** Donma: buz çatırtısı + parlak çınlama */
  private freeze(at: THREE.Vector3): void {
    const o = this.out(at, 1);
    if (!o) return;
    this.noiseHit(o, { type: 'highpass', f0: 5000, f1: 2500, dur: 0.35, gain: 0.6 });
    this.noiseHit(o, { type: 'bandpass', f0: 2600, f1: 1200, dur: 0.18, gain: 0.5, q: 4, delay: 0.04 });
    this.tone(o, { type: 'triangle', f0: 1760, f1: 1700, dur: 0.5, gain: 0.25, delay: 0.02 });
    this.tone(o, { type: 'sine', f0: 2640, f1: 2600, dur: 0.4, gain: 0.15, delay: 0.06 });
  }

  private ping(): void {
    const o = this.out(null, 0.4);
    if (!o) return;
    this.tone(o, { type: 'triangle', f0: 2200, f1: 2100, dur: 0.3, gain: 0.4 });
    this.tone(o, { type: 'sine', f0: 3300, f1: 3200, dur: 0.25, gain: 0.2 });
  }

  private whoosh(dur: number, f0: number, f1: number, gain: number): void {
    if (!this.gate('whoosh', 60)) return;
    const o = this.out(null, gain);
    if (!o) return;
    this.noiseHit(o, { type: 'bandpass', f0, f1, dur, gain: 1, q: 1.4, attack: 0.04 });
  }

  private slide(): void {
    const o = this.out(null, 0.25);
    if (!o) return;
    this.noiseHit(o, { type: 'highpass', f0: 1500, f1: 900, dur: 0.4, gain: 1, attack: 0.03 });
  }

  private land(): void {
    if (!this.gate('land', 150)) return;
    const o = this.out(null, 0.3);
    if (!o) return;
    this.noiseHit(o, { type: 'lowpass', f0: 500, f1: 100, dur: 0.12, gain: 1 });
  }

  private blip(el: ElementId): void {
    const o = this.out(null, 0.25);
    if (!o) return;
    const f = { earth: 330, water: 523, fire: 440, air: 659 }[el];
    this.tone(o, { type: 'triangle', f0: f, f1: f * 1.5, dur: 0.12, gain: 0.6 });
  }

  private denied(): void {
    if (!this.gate('denied', 150)) return;
    const o = this.out(null, 0.25);
    if (!o) return;
    this.tone(o, { type: 'square', f0: 140, f1: 120, dur: 0.12, gain: 0.5 });
  }

  private ui(): void {
    const o = this.out(null, 0.25);
    if (!o) return;
    this.tone(o, { type: 'triangle', f0: 1200, f1: 900, dur: 0.05, gain: 0.6 });
  }

  private beep(f: number, dur: number, gain: number, delay = 0): void {
    const o = this.out(null, gain);
    if (!o) return;
    this.tone(o, { type: 'square', f0: f, f1: f, dur, gain: 0.5, delay });
  }

  private jingle(notes: number[], step: number, type: OscillatorType = 'square'): void {
    const o = this.out(null, 0.3);
    if (!o) return;
    notes.forEach((f, i) => this.tone(o, { type, f0: f, f1: f, dur: step * 1.6, gain: 0.45, delay: i * step }));
  }
}
