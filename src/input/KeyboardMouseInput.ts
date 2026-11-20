import { GameConfig } from '../config/gameConfig';
import type { Action, InputSink, InputSource } from './InputActions';

const KEY_ACTIONS: Record<string, Action> = {
  Space: 'jump',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyC: 'slide', // Ctrl kullanılmıyor: Ctrl+W sekmeyi kapatır
  Digit1: 'element1',
  Digit2: 'element2',
  Digit3: 'element3',
  Digit4: 'element4',
  KeyQ: 'elementNext',
  KeyE: 'special',
  KeyR: 'reset',
};

const MOUSE_ACTIONS: Record<number, Action> = { 0: 'primary', 2: 'secondary' };

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export interface KeyboardMouseOptions {
  pointerLock: boolean;
  onPointerLockChange?: (locked: boolean) => void;
}

/** Masaüstü: WASD/ok tuşları + pointer-lock fare bakışı. */
export class KeyboardMouseInput implements InputSource {
  readonly move = { x: 0, y: 0 };
  private readonly keys = new Set<string>();
  private readonly heldActions = new Set<Action>();
  private readonly ac = new AbortController();

  constructor(
    private readonly sink: InputSink,
    private readonly lockTarget: HTMLElement,
    private readonly opts: KeyboardMouseOptions,
  ) {
    const signal = this.ac.signal;
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { signal });
    window.addEventListener('keyup', (e) => this.onKeyUp(e), { signal });
    window.addEventListener('blur', () => this.releaseAll(), { signal });
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll(), { signal });

    if (opts.pointerLock) {
      lockTarget.addEventListener('click', () => this.requestLock(), { signal });
      document.addEventListener('pointerlockchange', () => this.opts.onPointerLockChange?.(this.locked), { signal });
      document.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal });
      document.addEventListener('mousedown', (e) => this.onMouse(e, true), { signal });
      document.addEventListener('mouseup', (e) => this.onMouse(e, false), { signal });
      lockTarget.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
      document.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: true });
    }
  }

  get locked(): boolean {
    return document.pointerLockElement === this.lockTarget;
  }

  requestLock(): void {
    if (this.locked || !this.lockTarget.requestPointerLock) return;
    try {
      const p = this.lockTarget.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* desteklenmiyor */
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    this.updateMove();
    const a = KEY_ACTIONS[e.code];
    if (a) this.pressAction(a);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    this.updateMove();
    const a = KEY_ACTIONS[e.code];
    if (a && !this.anyKeyFor(a)) this.releaseAction(a);
  }

  private anyKeyFor(a: Action): boolean {
    for (const k of this.keys) if (KEY_ACTIONS[k] === a) return true;
    return false;
  }

  private onMouse(e: MouseEvent, down: boolean): void {
    if (!this.locked) return;
    const a = MOUSE_ACTIONS[e.button];
    if (!a) return;
    if (down) this.pressAction(a);
    else this.releaseAction(a);
  }

  private onWheel(e: WheelEvent): void {
    if (!this.locked || Math.abs(e.deltaY) < 1) return;
    const a: Action = e.deltaY > 0 ? 'elementNext' : 'elementPrev';
    this.sink.press(a);
    this.sink.release(a);
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    const max = GameConfig.input.maxMouseDelta;
    const dx = Math.max(-max, Math.min(max, e.movementX));
    const dy = Math.max(-max, Math.min(max, e.movementY));
    const s = GameConfig.input.mouseSensitivity;
    this.sink.look(dx * s, dy * s);
  }

  private pressAction(a: Action): void {
    if (this.heldActions.has(a)) return;
    this.heldActions.add(a);
    this.sink.press(a);
  }

  private releaseAction(a: Action): void {
    if (!this.heldActions.delete(a)) return;
    this.sink.release(a);
  }

  private updateMove(): void {
    const k = this.keys;
    const right = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;
    const left = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const fwd = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const back = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    this.move.x = right - left;
    this.move.y = fwd - back;
  }

  private releaseAll(): void {
    this.keys.clear();
    this.updateMove();
    for (const a of [...this.heldActions]) this.releaseAction(a);
  }

  dispose(): void {
    this.releaseAll();
    this.ac.abort();
  }
}
