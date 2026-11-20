import { GameConfig } from '../config/gameConfig';
import type { Action, InputSink, InputSource } from './InputActions';

interface ButtonDef {
  action: Action;
  label: string;
  cls: string;
}

/** Dokunmatik buton yerleşimi; Task 2+ yetenek butonları buraya eklenir. */
export const TOUCH_BUTTONS: ButtonDef[] = [
  { action: 'primary', label: 'SALDIR', cls: 'primary' },
  { action: 'secondary', label: 'YETENEK', cls: 'secondary' },
  { action: 'jump', label: 'ZIPLA', cls: 'jump' },
  { action: 'dash', label: 'DASH', cls: 'dash' },
  { action: 'slide', label: 'KAY', cls: 'slide' },
];

/**
 * Mobil (iOS Safari / Android Chrome): Pointer Events tabanlı çoklu dokunuş.
 * - Sol bölge: dinamik sanal analog (parmağın değdiği yerde belirir)
 * - Sağ bölge: sürükleyerek bakış
 * - Butonlar: basılı tutma + cooldown göstergesi
 * Fare olaylarını (pointerType === 'mouse') yok sayar; masaüstü input'u ile çakışmaz.
 */
export class TouchInput implements InputSource {
  readonly move = { x: 0, y: 0 };

  private readonly ui: HTMLDivElement;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly buttons = new Map<Action, HTMLElement>();
  private readonly ac = new AbortController();

  private joyId: number | null = null;
  private joyCx = 0;
  private joyCy = 0;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;

  constructor(
    private readonly sink: InputSink,
    private readonly root: HTMLElement,
  ) {
    const signal = this.ac.signal;
    this.ui = document.createElement('div');
    this.ui.className = 'touch-ui';
    this.ui.style.setProperty('--joy-r', `${GameConfig.input.joystickRadius}px`);

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    this.ui.appendChild(this.joyBase);

    const cluster = document.createElement('div');
    cluster.className = 'touch-buttons';
    for (const def of TOUCH_BUTTONS) cluster.appendChild(this.makeButton(def, signal));
    this.ui.appendChild(cluster);

    const reset = this.makeButton({ action: 'pause', label: 'II', cls: 'reset' }, signal);
    this.ui.appendChild(reset);

    root.appendChild(this.ui);
    this.placeJoystickRest();

    root.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    root.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    root.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    root.addEventListener('pointercancel', (e) => this.onUp(e), { signal });
    window.addEventListener('resize', () => this.joyId === null && this.placeJoystickRest(), { signal });
    // iOS Safari: pinch-zoom / çift dokunma jestlerini engelle
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { signal, passive: false } as AddEventListenerOptions);
    document.addEventListener('touchmove', (e) => e.preventDefault(), { signal, passive: false });
  }

  /** 0 = hazır, 1 = yeni kullanıldı */
  setCooldown(action: Action, ratio: number): void {
    const el = this.buttons.get(action);
    if (el) el.style.setProperty('--cd', ratio.toFixed(3));
  }

  /** Buton etiketini, ikonunu ve vurgu rengini değiştir (aktif elemente göre yetenek). */
  setButton(action: Action, label: string, color?: string, iconSvg?: string): void {
    const el = this.buttons.get(action);
    if (!el) return;
    const lbl = el.querySelector('.lbl');
    if (lbl && lbl.textContent !== label) lbl.textContent = label;
    if (color) el.style.setProperty('--accent-c', color);
    if (iconSvg !== undefined) {
      let ic = el.querySelector<HTMLElement>('.ic');
      if (!ic) {
        ic = document.createElement('span');
        ic.className = 'ic';
        el.insertBefore(ic, lbl);
      }
      if (ic.innerHTML !== iconSvg) ic.innerHTML = iconSvg;
      el.classList.toggle('has-icon', iconSvg !== '');
    }
  }

  /** Kullanılamayan yetenek için kısa uyarı animasyonu. */
  flash(action: Action): void {
    const el = this.buttons.get(action);
    if (!el) return;
    el.classList.remove('denied');
    void el.offsetWidth; // animasyonu yeniden başlat
    el.classList.add('denied');
  }

  private makeButton(def: ButtonDef, signal: AbortSignal): HTMLElement {
    const el = document.createElement('div');
    el.className = `tbtn ${def.cls}`;
    el.innerHTML = `<span class="cd"></span><span class="lbl">${def.label}</span>`;
    let activeId: number | null = null;
    const up = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      el.classList.remove('active');
      this.sink.release(def.action);
    };
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse') return;
        e.stopPropagation();
        e.preventDefault();
        if (activeId !== null) return;
        activeId = e.pointerId;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* yakalama desteklenmiyor; pointerup yine de gelir */
        }
        el.classList.add('active');
        this.sink.press(def.action);
      },
      { signal },
    );
    el.addEventListener('pointerup', up, { signal });
    el.addEventListener('pointercancel', up, { signal });
    el.addEventListener('lostpointercapture', up, { signal });
    this.buttons.set(def.action, el);
    return el;
  }

  private placeJoystickRest(): void {
    const r = GameConfig.input.joystickRadius;
    const x = r + 36;
    const y = window.innerHeight - r - 36;
    this.joyBase.style.left = `${x}px`;
    this.joyBase.style.top = `${y}px`;
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const inJoyZone = e.clientX < window.innerWidth * GameConfig.input.joystickZoneWidth;
    if (inJoyZone && this.joyId === null) {
      this.joyId = e.pointerId;
      const r = GameConfig.input.joystickRadius;
      // Taban ekran dışına taşmasın
      this.joyCx = Math.max(r + 8, Math.min(window.innerWidth - r - 8, e.clientX));
      this.joyCy = Math.max(r + 8, Math.min(window.innerHeight - r - 8, e.clientY));
      this.joyBase.style.left = `${this.joyCx}px`;
      this.joyBase.style.top = `${this.joyCy}px`;
      this.joyBase.classList.add('active');
      this.capture(e);
      this.updateJoystick(e.clientX, e.clientY);
    } else if (!inJoyZone && this.lookId === null) {
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.capture(e);
    }
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      this.updateJoystick(e.clientX, e.clientY);
    } else if (e.pointerId === this.lookId) {
      const s = GameConfig.input.touchLookSensitivity;
      this.sink.look((e.clientX - this.lookX) * s, (e.clientY - this.lookY) * s);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    }
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.joyId) {
      this.joyId = null;
      this.move.x = this.move.y = 0;
      this.joyBase.classList.remove('active');
      this.placeJoystickRest();
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  private updateJoystick(px: number, py: number): void {
    const r = GameConfig.input.joystickRadius;
    let dx = px - this.joyCx;
    let dy = py - this.joyCy;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    let nx = dx / r;
    let ny = -dy / r; // ekranda yukarı = ileri
    const mag = Math.hypot(nx, ny);
    const dz = GameConfig.input.joystickDeadzone;
    if (mag < dz) {
      nx = ny = 0;
    } else {
      const scaled = (mag - dz) / (1 - dz) / mag;
      nx *= scaled;
      ny *= scaled;
    }
    this.move.x = nx;
    this.move.y = ny;
  }

  private capture(e: PointerEvent): void {
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* bazı tarayıcılar */
    }
  }

  dispose(): void {
    this.ac.abort();
    this.ui.remove();
  }
}
