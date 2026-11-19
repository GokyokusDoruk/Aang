import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { clamp, damp, wrapAngle } from '../core/math';

/**
 * Omuz üstü üçüncü şahıs kamera rig'i (saf matematik; Three kamerasına render katmanı uygular).
 * - yaw/pitch input'tan gelir
 * - pivot oyuncuyu yumuşak takip eder
 * - omuz ve geri doğrultusunda ışın testi ile duvar arkasına kaçmaz
 * - aimPoint: ekran merkezinden (crosshair) dünyaya nişan noktası; yetenekler bunu kullanacak
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = GameConfig.camera.defaultPitch;
  currentDistance = GameConfig.camera.distance;

  readonly position = new Vector3();
  readonly forward = new Vector3(0, 0, -1);
  readonly aimPoint = new Vector3();
  aimHit = false;

  private readonly pivot = new Vector3();
  private readonly desiredPivot = new Vector3();
  private readonly back = new Vector3();
  private readonly right = new Vector3();
  private readonly shoulder = new Vector3();
  private readonly tmp = new Vector3();
  private initialized = false;
  /** Ek nişan hedefleri (karakterler). Mesafe döndürür; yoksa null. */
  aimProbe: ((origin: Vector3, dir: Vector3, maxDist: number) => number | null) | null = null;

  constructor(private readonly world: CollisionWorld) {}

  applyLook(dx: number, dy: number): void {
    const C = GameConfig.camera;
    this.yaw = wrapAngle(this.yaw - dx);
    this.pitch = clamp(this.pitch + dy * (GameConfig.input.invertY ? -1 : 1), C.minPitch, C.maxPitch);
  }

  /** Sonraki update'te pivotu yumuşatmadan hedefe oturt (respawn vb.). */
  snap(): void {
    this.initialized = false;
  }

  update(dt: number, target: Vector3, heightRatio: number): void {
    const C = GameConfig.camera;

    this.desiredPivot.set(target.x, target.y + C.pivotHeight * (0.6 + 0.4 * heightRatio), target.z);
    if (!this.initialized) {
      this.pivot.copy(this.desiredPivot);
      this.currentDistance = C.distance;
      this.initialized = true;
    } else {
      const kh = damp(C.followSharpness, dt);
      const kv = damp(C.verticalFollowSharpness, dt);
      this.pivot.x += (this.desiredPivot.x - this.pivot.x) * kh;
      this.pivot.z += (this.desiredPivot.z - this.pivot.z) * kh;
      this.pivot.y += (this.desiredPivot.y - this.pivot.y) * kv;
    }

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.back.set(sy * cp, sp, cy * cp);
    this.right.set(cy, 0, -sy);

    // Omuz noktası (yan duvara gömülmesin)
    let side = C.shoulderOffset;
    const sideHit = this.world.raycast(this.pivot, this.right, C.shoulderOffset + C.collisionMargin);
    if (sideHit) side = Math.max(0, sideHit.distance - C.collisionMargin);
    this.shoulder.copy(this.pivot).addScaledVector(this.right, side);

    // Geri doğrultuda çarpışma: yaklaşırken anında, uzaklaşırken yumuşak
    const hit = this.world.raycast(this.shoulder, this.back, C.distance + C.collisionMargin);
    const targetDist = hit ? Math.max(C.minDistance, hit.distance - C.collisionMargin) : C.distance;
    if (targetDist < this.currentDistance) this.currentDistance = targetDist;
    else this.currentDistance += (targetDist - this.currentDistance) * damp(C.returnSharpness, dt);

    this.position.copy(this.shoulder).addScaledVector(this.back, this.currentDistance);
    this.forward.copy(this.back).multiplyScalar(-1);

    // Nişan: oyuncu düzleminden başlayan ışın (kamera ile oyuncu arasındaki engeller yok sayılır)
    this.tmp.copy(this.position).addScaledVector(this.forward, this.currentDistance);
    const aim = this.world.raycast(this.tmp, this.forward, C.aimMaxDistance);
    let dist = aim ? aim.distance : C.aimMaxDistance;
    const body = this.aimProbe?.(this.tmp, this.forward, dist) ?? null;
    if (body !== null) dist = body;
    this.aimHit = aim !== null || body !== null;
    this.aimPoint.copy(this.tmp).addScaledVector(this.forward, dist);
  }
}
