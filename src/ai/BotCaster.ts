import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { AbilityCaster } from '../abilities/types';
import type { Combatant } from '../combat/Combatant';
import type { PlayerController } from '../game/PlayerController';

export interface BotDifficulty {
  reactionTime: number;
  aimErrorDeg: number;
  attackChance: number;
  dodgeChance: number;
}

const right = new Vector3();
const err = new Vector3();
const up = new Vector3(0, 1, 0);

/**
 * Botun yetenek "nişanı": hedefin göğsüne, hızına göre önleyerek ve
 * zorluğa bağlı rastgele sapmayla. Hareket yetenekleri için `aimOverride` noktası verilebilir.
 */
export class BotCaster implements AbilityCaster {
  target: Combatant | null = null;
  /** Bir sonraki kullanım için sabit hedef noktası (duvar yeri, kayma yönü...) */
  aimOverride: Vector3 | null = null;

  constructor(
    readonly id: string,
    private readonly self: Combatant,
    private readonly difficulty: () => BotDifficulty,
  ) {}

  get position(): Vector3 {
    return this.self.position;
  }

  get grounded(): boolean {
    return this.self.controller.grounded;
  }

  get controller(): PlayerController {
    return this.self.controller;
  }

  getAim(outOrigin: Vector3, outDirection: Vector3, outTarget: Vector3): void {
    const ctl = this.self.controller;
    const yaw = ctl.facingYaw;
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    outOrigin.copy(ctl.position).addScaledVector(right, 0.35).setY(ctl.position.y + ctl.height * 0.72);

    if (this.aimOverride) {
      outTarget.copy(this.aimOverride);
      this.aimOverride = null;
    } else if (this.target) {
      this.target.center(outTarget);
      const dist = outTarget.distanceTo(outOrigin);
      // Önleme: ortalama mermi hızına göre
      const t = (dist / 40) * GameConfig.bot.leadFactor;
      outTarget.addScaledVector(this.target.controller.velocity, t);
      // Sapma: nişan doğrultusuna dik rastgele ofset
      const spread = dist * Math.tan((this.difficulty().aimErrorDeg * Math.PI) / 180);
      err.subVectors(outTarget, outOrigin).normalize();
      const side = new Vector3().crossVectors(err, up).normalize();
      const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      outTarget.addScaledVector(side, spread * g()).addScaledVector(up, spread * 0.6 * g());
    } else {
      outTarget.copy(outOrigin).add(new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(10));
    }
    outDirection.subVectors(outTarget, outOrigin).normalize();
  }
}
