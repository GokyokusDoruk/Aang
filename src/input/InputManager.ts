import { ACTIONS, emptyFlags, type Action, type InputSink, type InputSource, type StepInput } from './InputActions';
import { KeyboardMouseInput } from './KeyboardMouseInput';
import { TouchInput } from './TouchInput';

export interface InputManagerOptions {
  touch: boolean;
  onPointerLockChange?: (locked: boolean) => void;
}

/**
 * Tüm input kaynaklarını birleştirir.
 * - Bakış deltası her render karesinde tüketilir (consumeLook) → düşük gecikme
 * - Hareket + aksiyonlar her fizik adımında örneklenir (sampleStep)
 * - "pressed" kenarları, bir fizik adımı onları okuyana kadar saklanır (yüksek FPS'te kaybolmaz)
 */
export class InputManager implements InputSink {
  readonly keyboardMouse: KeyboardMouseInput;
  readonly touch: TouchInput | null;

  private readonly sources: InputSource[] = [];
  private readonly holdCount = new Map<Action, number>();
  private readonly pressedEdges = new Set<Action>();
  private lookDX = 0;
  private lookDY = 0;
  private readonly step: StepInput = { moveX: 0, moveY: 0, held: emptyFlags(), pressed: emptyFlags() };

  constructor(root: HTMLElement, lockTarget: HTMLElement, opts: InputManagerOptions) {
    this.keyboardMouse = new KeyboardMouseInput(this, lockTarget, {
      pointerLock: !opts.touch,
      onPointerLockChange: opts.onPointerLockChange,
    });
    this.sources.push(this.keyboardMouse);
    this.touch = opts.touch ? new TouchInput(this, root) : null;
    if (this.touch) this.sources.push(this.touch);
  }

  press(action: Action): void {
    this.holdCount.set(action, (this.holdCount.get(action) ?? 0) + 1);
    this.pressedEdges.add(action);
  }

  release(action: Action): void {
    this.holdCount.set(action, Math.max(0, (this.holdCount.get(action) ?? 0) - 1));
  }

  look(dx: number, dy: number): void {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  consumeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    return r;
  }

  /** Bir fizik adımı için input; dönen nesne yeniden kullanılır (GC yok). */
  sampleStep(): StepInput {
    let mx = 0;
    let my = 0;
    for (const s of this.sources) {
      mx += s.move.x;
      my += s.move.y;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.step.moveX = mx;
    this.step.moveY = my;
    for (const a of ACTIONS) {
      this.step.held[a] = (this.holdCount.get(a) ?? 0) > 0;
      this.step.pressed[a] = this.pressedEdges.has(a);
    }
    this.pressedEdges.clear();
    return this.step;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose();
  }
}
