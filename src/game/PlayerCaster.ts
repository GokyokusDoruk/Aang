import { Vector3 } from 'three';
import type { AbilityCaster } from '../abilities/types';
import type { PlayerController } from './PlayerController';
import type { ThirdPersonCamera } from './ThirdPersonCamera';

/** Oyuncuyu yetenek sistemine bağlar: çıkış noktası el hizası, hedef kameranın nişan noktası. */
export class PlayerCaster implements AbilityCaster {
  private readonly right = new Vector3();

  constructor(
    readonly id: string,
    private readonly player: PlayerController,
    private readonly camera: ThirdPersonCamera,
  ) {}

  get position(): Vector3 {
    return this.player.position;
  }

  get controller(): PlayerController {
    return this.player;
  }

  get grounded(): boolean {
    return this.player.grounded;
  }

  getAim(outOrigin: Vector3, outDirection: Vector3, outTarget: Vector3): void {
    const yaw = this.camera.yaw;
    this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    outOrigin
      .copy(this.player.position)
      .addScaledVector(this.right, 0.35)
      .setY(this.player.position.y + this.player.height * 0.72);
    outTarget.copy(this.camera.aimPoint);
    outDirection.subVectors(outTarget, outOrigin);
    // Hedef çok yakın / arkada kalırsa kamera yönünü kullan
    if (outDirection.lengthSq() < 0.25 || outDirection.dot(this.camera.forward) <= 0) {
      outDirection.copy(this.camera.forward);
      outTarget.copy(outOrigin).addScaledVector(outDirection, 20);
    }
    outDirection.normalize();
  }
}
