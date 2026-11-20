import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { SpawnPoint } from '../config/arenaLayout';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { StepInput } from '../input/InputActions';
import { damp, wrapAngle } from '../core/math';

export type MoveState = 'grounded' | 'airborne' | 'sliding' | 'crouching' | 'dashing' | 'gliding' | 'floating';

const tmpPush = new Vector3();

/**
 * Kinematik karakter kontrolcüsü (saf oyun mantığı, render yok).
 * Konum = ayak tabanı. Sabit adımla (fixedUpdate) çalışır.
 * Koşma, zıplama (coyote + buffer + değişken yükseklik + hava zıplaması),
 * hava kontrolü, kayma (slide) ve dash içerir.
 */
export class PlayerController {
  readonly position = new Vector3();
  readonly prevPosition = new Vector3();
  readonly velocity = new Vector3();

  grounded = false;
  sliding = false;
  /** Kayma tuşu (C) basılı tutulurken yerde eğik durma; eğikken yürünür ve yetenek kullanılır. */
  crouching = false;
  dashing = false;

  facingYaw = 0;
  prevFacingYaw = 0;
  /** 1 = ayakta, slideHeight/height = kayma. */
  heightRatio = 1;
  prevHeightRatio = 1;

  airJumpsLeft = 0;
  airDashesLeft = 0;
  /** Dış sistemlerin (yetenek hazırlığı, ileride yavaşlatma etkileri) koşu hızına çarpanı. */
  moveSpeedMultiplier = 1;
  /** Durum etkilerinden gelen hız çarpanı (üşüme); Combatant yönetir. */
  statusSpeedMultiplier = 1;
  /** >0 iken itilmiş durumda: koşu kontrolü yok, karakter savrulur. */
  knockbackTimer = 0;
  /** Arena dışına düşüp yeniden doğduğunda true olur (Combatant tüketir). */
  fellOut = false;
  /** >0 iken Buz Kayması modu (Su). */
  glideTimer = 0;
  /** >0 iken Rüzgar süzülmesi (Hava): zıplama basılıyken yavaş düşüş. */
  floatTimer = 0;
  dashCooldown = 0;
  slideCooldown = 0;

  private dashTimer = 0;
  private slideTimer = 0;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private jumpHeld = false;
  /** Yükseliş bir zıplamadan mı geliyor (değişken zıplama yüksekliği için). */
  private jumpRising = false;

  constructor(
    private readonly world: CollisionWorld,
    private spawn: SpawnPoint,
  ) {
    this.respawn();
  }

  get height(): number {
    return GameConfig.player.height * this.heightRatio;
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get state(): MoveState {
    if (this.dashing) return 'dashing';
    if (this.sliding) return 'sliding';
    if (this.crouching) return 'crouching';
    if (this.glideTimer > 0) return 'gliding';
    if (this.floatTimer > 0 && !this.grounded) return 'floating';
    return this.grounded ? 'grounded' : 'airborne';
  }

  respawn(spawn: SpawnPoint = this.spawn): void {
    this.spawn = spawn;
    this.position.set(spawn.x, spawn.y, spawn.z);
    this.prevPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.sliding = false;
    this.crouching = false;
    this.dashing = false;
    this.facingYaw = this.prevFacingYaw = spawn.yaw;
    this.heightRatio = this.prevHeightRatio = 1;
    this.dashTimer = this.slideTimer = this.coyoteTimer = this.jumpBufferTimer = 0;
    this.dashCooldown = this.slideCooldown = 0;
    this.knockbackTimer = 0;
    this.glideTimer = this.floatTimer = 0;
    this.airJumpsLeft = GameConfig.player.maxAirJumps;
    this.airDashesLeft = GameConfig.dash.maxAirDashes;
  }

  fixedUpdate(dt: number, input: StepInput, cameraYaw: number): void {
    const P = GameConfig.player;
    this.prevPosition.copy(this.position);
    this.prevFacingYaw = this.facingYaw;
    this.prevHeightRatio = this.heightRatio;

    if (input.pressed.reset) {
      this.respawn();
      return;
    }

    // --- Zamanlayıcılar
    this.knockbackTimer = Math.max(0, this.knockbackTimer - dt);
    this.glideTimer = Math.max(0, this.glideTimer - dt);
    this.floatTimer = Math.max(0, this.floatTimer - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.coyoteTimer = this.grounded ? P.coyoteTime : Math.max(0, this.coyoteTimer - dt);
    this.jumpBufferTimer = input.pressed.jump ? P.jumpBufferTime : Math.max(0, this.jumpBufferTimer - dt);
    this.jumpHeld = input.held.jump;

    // --- Kamera yönüne göre istenen hareket yönü (dünya XZ)
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw);
    const rz = -Math.sin(cameraYaw);
    let wx = fx * input.moveY + rx * input.moveX;
    let wz = fz * input.moveY + rz * input.moveX;
    const wishLen = Math.hypot(wx, wz);
    if (wishLen > 1) {
      wx /= wishLen;
      wz /= wishLen;
    }
    const wishMag = Math.min(1, wishLen);

    // --- Aksiyonlar
    if (input.pressed.dash) this.tryDash(wx, wz, wishMag, fx, fz);
    if (input.pressed.slide) this.trySlide(wx, wz, wishMag);
    this.handleJump(wx, wz, wishMag);

    // Eğilme: kayma tuşu basılıyken yerde, kayma bitince de eğik kal
    this.crouching = !this.sliding && input.held.slide && this.grounded && !this.dashing && this.glideTimer <= 0;

    // --- Yatay hız
    if (this.dashing) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) this.endDash();
    } else if (this.sliding) {
      this.updateSlide(dt, wx, wz, wishMag);
    } else {
      this.updateRun(dt, wx, wz, wishMag);
    }

    // --- Dikey hız (dash sırasında yerçekimi askıda)
    if (!this.dashing) {
      let g = GameConfig.physics.gravity;
      if (this.velocity.y <= 0) this.jumpRising = false;
      // Değişken zıplama yalnızca gerçek zıplamalarda (fırlatma/itme yüksekliğini kesmez)
      if (this.velocity.y > 0 && this.jumpRising && !this.jumpHeld) g *= P.jumpCutGravityMult;
      else if (this.velocity.y < 0) g *= P.fallGravityMult;
      if (this.glideTimer > 0 && this.velocity.y < 0) g *= GameConfig.water.glide.airGravityMult;
      this.velocity.y = Math.max(this.velocity.y - g * dt, -GameConfig.physics.maxFallSpeed);
      // Rüzgar süzülmesi: zıplama basılı tutulurken düşüş hızı sınırlanır
      const fall = GameConfig.air.leap.floatFallSpeed;
      if (this.floatTimer > 0 && this.jumpHeld && this.velocity.y < -fall) this.velocity.y = -fall;
    }

    // --- Boy (kayma çömelmesi)
    const targetRatio = this.sliding || this.crouching ? P.slideHeight / P.height : 1;
    this.heightRatio += (targetRatio - this.heightRatio) * damp(P.heightSharpness, dt);

    // --- Entegrasyon + çarpışma
    this.moveHorizontal(dt);
    this.moveVertical(dt);
    if (this.grounded && this.velocity.y <= 0) this.floatTimer = 0;

    // --- Bakış yönü
    let targetYaw = cameraYaw;
    if ((this.dashing || this.sliding || this.glideTimer > 0) && this.horizontalSpeed > 1) {
      targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
    }
    this.facingYaw = wrapAngle(this.facingYaw + wrapAngle(targetYaw - this.facingYaw) * damp(P.turnSharpness, dt));

    if (this.position.y < GameConfig.physics.killY) {
      this.respawn();
      this.fellOut = true;
    }
  }

  /** Dış kuvvet (hasar itmesi, rüzgar...). Yatay hız eklenir, dikey bileşen yerden kaldırır. */
  applyKnockback(impulse: Vector3): void {
    if (this.sliding) this.endSlide();
    this.dashing = false;
    this.velocity.x += impulse.x;
    this.velocity.z += impulse.z;
    if (impulse.y > 0) {
      this.velocity.y = Math.max(this.velocity.y, 0) + impulse.y;
      this.jumpRising = false;
      this.grounded = false;
      this.coyoteTimer = 0;
    }
    this.knockbackTimer = GameConfig.combat.knockbackControlLoss;
  }

  /** Buz Kayması: verilen yönde (yatay) momentumlu süzülmeyi başlat. */
  startGlide(dirX: number, dirZ: number): void {
    const G = GameConfig.water.glide;
    const l = Math.hypot(dirX, dirZ) || 1;
    if (this.sliding) this.endSlide();
    const speed = Math.max(this.horizontalSpeed, G.startSpeed);
    this.velocity.x = (dirX / l) * speed;
    this.velocity.z = (dirZ / l) * speed;
    this.glideTimer = G.duration;
  }

  /** Rüzgar Sıçrayışı: yukarı + ileri fırlat, ardından süzülme penceresi aç. */
  launch(dirX: number, dirZ: number): void {
    const L = GameConfig.air.leap;
    const l = Math.hypot(dirX, dirZ) || 1;
    if (this.sliding) this.endSlide();
    this.dashing = false;
    const fwd = Math.max(L.forwardVelocity, this.horizontalSpeed * 0.6);
    this.velocity.x = (dirX / l) * fwd;
    this.velocity.z = (dirZ / l) * fwd;
    this.velocity.y = L.upVelocity;
    this.jumpRising = false;
    this.grounded = false;
    this.coyoteTimer = 0;
    this.floatTimer = L.floatDuration;
    this.airJumpsLeft = GameConfig.player.maxAirJumps;
  }

  // ---------------------------------------------------------------- aksiyonlar

  private handleJump(wx: number, wz: number, wishMag: number): void {
    const P = GameConfig.player;
    if (this.jumpBufferTimer <= 0) return;

    if (this.grounded || this.coyoteTimer > 0) {
      // Yer zıplaması. Kayma / dash momentumu korunur (slide-jump).
      if (this.sliding) this.endSlide();
      if (this.dashing) this.endDash();
      this.velocity.y = P.jumpVelocity;
      this.jumpRising = true;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
    } else if (this.airJumpsLeft > 0 && !this.dashing) {
      // Hava zıplaması: yön değiştirmeye izin verir, hız kazandırmaz.
      this.velocity.y = P.airJumpVelocity;
      this.jumpRising = true;
      this.airJumpsLeft--;
      this.jumpBufferTimer = 0;
      if (wishMag > 0.1) {
        const speed = Math.max(this.horizontalSpeed, P.runSpeed * wishMag);
        this.velocity.x = (wx / wishMag) * speed;
        this.velocity.z = (wz / wishMag) * speed;
      }
    }
  }

  private tryDash(wx: number, wz: number, wishMag: number, fx: number, fz: number): void {
    const D = GameConfig.dash;
    if (this.dashing || this.dashCooldown > 0) return;
    if (!this.grounded && this.airDashesLeft <= 0) return;
    let dx = fx;
    let dz = fz;
    if (wishMag > 0.1) {
      dx = wx / wishMag;
      dz = wz / wishMag;
    }
    if (this.sliding) this.endSlide();
    this.velocity.set(dx * D.speed, 0, dz * D.speed);
    this.dashing = true;
    this.dashTimer = D.duration;
    this.dashCooldown = D.cooldown;
    if (!this.grounded) this.airDashesLeft--;
  }

  private endDash(): void {
    this.dashing = false;
    const s = this.horizontalSpeed;
    const max = GameConfig.dash.exitSpeed;
    if (s > max) {
      this.velocity.x *= max / s;
      this.velocity.z *= max / s;
    }
  }

  private trySlide(wx: number, wz: number, wishMag: number): void {
    const S = GameConfig.slide;
    if (!this.grounded || this.sliding || this.dashing || this.glideTimer > 0 || this.slideCooldown > 0) return;
    let speed = this.horizontalSpeed;
    let dx: number;
    let dz: number;
    if (speed >= S.minStartSpeed) {
      dx = this.velocity.x / speed;
      dz = this.velocity.z / speed;
    } else if (wishMag > 0.1) {
      dx = wx / wishMag;
      dz = wz / wishMag;
      speed = GameConfig.player.runSpeed;
    } else {
      return;
    }
    const newSpeed = Math.min(speed + S.boost, S.maxSpeed);
    this.velocity.x = dx * newSpeed;
    this.velocity.z = dz * newSpeed;
    this.sliding = true;
    this.slideTimer = S.maxDuration;
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideCooldown = GameConfig.slide.cooldown;
  }

  // ---------------------------------------------------------------- hız güncellemeleri

  private updateSlide(dt: number, wx: number, wz: number, wishMag: number): void {
    const S = GameConfig.slide;
    this.slideTimer -= dt;
    if (!this.grounded) {
      this.endSlide(); // kenardan uçarken momentum korunur
      return;
    }
    let speed = this.horizontalSpeed;
    speed = Math.max(0, speed - S.friction * dt);
    let ang = Math.atan2(this.velocity.x, this.velocity.z);
    if (wishMag > 0.1) {
      const wishAng = Math.atan2(wx, wz);
      const delta = wrapAngle(wishAng - ang);
      const maxTurn = S.steer * dt;
      ang += Math.max(-maxTurn, Math.min(maxTurn, delta));
    }
    this.velocity.x = Math.sin(ang) * speed;
    this.velocity.z = Math.cos(ang) * speed;
    if (speed < S.endSpeed || this.slideTimer <= 0) this.endSlide();
  }

  /** Buz Kayması: geniş dönüşlü, düşük sürtünmeli hareket (yerde ve havada). */
  private updateGlide(dt: number, wx: number, wz: number, wishMag: number): void {
    const G = GameConfig.water.glide;
    let speed = this.horizontalSpeed;
    let ang = Math.atan2(this.velocity.x, this.velocity.z);
    if (wishMag > 0.1) {
      const delta = wrapAngle(Math.atan2(wx, wz) - ang);
      const maxTurn = G.turnRate * dt;
      ang += Math.max(-maxTurn, Math.min(maxTurn, delta));
      speed = Math.min(G.maxSpeed * this.moveSpeedMultiplier * this.statusSpeedMultiplier, speed + G.accel * wishMag * dt);
    } else {
      speed = Math.max(0, speed - G.friction * dt);
    }
    this.velocity.x = Math.sin(ang) * speed;
    this.velocity.z = Math.cos(ang) * speed;
  }

  private updateRun(dt: number, wx: number, wz: number, wishMag: number): void {
    const P = GameConfig.player;
    const v = this.velocity;
    const speed = this.horizontalSpeed;

    if (this.knockbackTimer > 0) {
      // Savrulma: input yok, yerde sürtünmeyle yavaşla, havada momentumu koru
      if (this.grounded && speed > 0) {
        const ns = Math.max(0, speed - GameConfig.combat.knockbackGroundFriction * dt);
        v.x *= ns / speed;
        v.z *= ns / speed;
      }
      return;
    }

    if (this.glideTimer > 0) {
      this.updateGlide(dt, wx, wz, wishMag);
      return;
    }

    if (this.grounded) {
      const run = P.runSpeed * this.moveSpeedMultiplier * this.statusSpeedMultiplier * (this.crouching ? GameConfig.slide.crouchSpeedMult : 1);
      const tx = wx * run;
      const tz = wz * run;
      let accel = wishMag > 0.01 ? P.groundAccel : P.groundDecel;
      if (speed > P.runSpeed + 0.5) accel = P.overspeedDecel;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const dist = Math.hypot(dx, dz);
      const maxDelta = accel * dt;
      if (dist <= maxDelta) {
        v.x = tx;
        v.z = tz;
      } else {
        v.x += (dx / dist) * maxDelta;
        v.z += (dz / dist) * maxDelta;
      }
    } else {
      // Hava kontrolü: yön verilebilir, ama mevcut momentumun üstüne hız eklenmez.
      const airAccel = P.airAccel * (this.floatTimer > 0 ? GameConfig.air.leap.floatAirAccelMult : 1);
      v.x += wx * airAccel * dt;
      v.z += wz * airAccel * dt;
      const limit = Math.max(speed, P.runSpeed);
      let ns = Math.hypot(v.x, v.z);
      if (ns > limit) {
        v.x *= limit / ns;
        v.z *= limit / ns;
        ns = limit;
      }
      if (ns > P.runSpeed) {
        const reduced = Math.max(P.runSpeed, ns - P.airDrag * dt);
        v.x *= reduced / ns;
        v.z *= reduced / ns;
      }
    }
  }

  // ---------------------------------------------------------------- çarpışma

  private moveHorizontal(dt: number): void {
    const P = GameConfig.player;
    const r = P.radius;
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.5)));
    const sx = dx / steps;
    const sz = dz / steps;
    const stepAllowance = this.grounded ? P.stepHeight : P.airStepHeight;
    const pos = this.position;

    for (let i = 0; i < steps; i++) {
      const ox = pos.x;
      const oz = pos.z;
      pos.x += sx;
      pos.z += sz;

      tmpPush.set(0, 0, 0);
      if (this.world.pushOut(pos, r, pos.y, pos.y + this.height, pos.y + stepAllowance, tmpPush)) {
        const len = Math.hypot(tmpPush.x, tmpPush.z);
        if (len > 1e-6) {
          const nx = tmpPush.x / len;
          const nz = tmpPush.z / len;
          const vn = this.velocity.x * nx + this.velocity.z * nz;
          if (vn < 0) {
            this.velocity.x -= nx * vn;
            this.velocity.z -= nz * vn;
          }
        }
      }

      // Rampanın yan yüzü / aşırı dik kısım: o eksendeki hareketi geri al.
      const limit = pos.y + stepAllowance;
      if (this.world.rampHeightAt(pos.x, pos.z) > limit) {
        if (this.world.rampHeightAt(ox, pos.z) <= limit) {
          pos.x = ox;
          this.velocity.x = 0;
        } else if (this.world.rampHeightAt(pos.x, oz) <= limit) {
          pos.z = oz;
          this.velocity.z = 0;
        } else {
          pos.x = ox;
          pos.z = oz;
          this.velocity.x = this.velocity.z = 0;
        }
      }
    }
  }

  private moveVertical(dt: number): void {
    const P = GameConfig.player;
    const pos = this.position;
    const wasGrounded = this.grounded;
    const oldY = pos.y;
    let newY = oldY + this.velocity.y * dt;

    if (this.velocity.y > 0) {
      const ceil = this.world.ceilingY(pos.x, pos.z, P.radius * 0.9, oldY + this.height, newY + this.height);
      if (ceil !== null) {
        newY = ceil - this.height;
        this.velocity.y = 0;
      }
    }

    const tolerance = wasGrounded ? P.stepHeight : P.airStepHeight;
    const ground = this.world.groundHeight(pos.x, pos.z, P.radius * P.footprintScale, oldY + tolerance);

    if (this.velocity.y <= 0 && newY <= ground) {
      pos.y = ground;
      this.velocity.y = 0;
      this.land();
    } else if (this.velocity.y <= 0 && wasGrounded && newY - ground <= P.groundSnapDistance) {
      // Rampadan / basamaktan inerken zemine yapışık kal.
      pos.y = ground;
      this.velocity.y = 0;
      this.land();
    } else {
      pos.y = newY;
      this.grounded = false;
    }
  }

  private land(): void {
    this.grounded = true;
    this.airJumpsLeft = GameConfig.player.maxAirJumps;
    this.airDashesLeft = GameConfig.dash.maxAirDashes;
  }
}
