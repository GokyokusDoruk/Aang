import { Vector3 } from 'three';
import { GameConfig } from '../config/gameConfig';
import type { AbilityIntent, AbilitySystem } from '../abilities/AbilitySystem';
import type { ElementId } from '../abilities/elements';
import type { Combatant } from '../combat/Combatant';
import type { ProjectileSystem } from '../combat/ProjectileSystem';
import { emptyFlags, type StepInput } from '../input/InputActions';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { BotCaster, BotDifficulty } from './BotCaster';
import { findCover } from './coverPoints';

export type BotState = 'engage' | 'cover' | 'recover';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const myC = new Vector3();
const tC = new Vector3();
const toT = new Vector3();
const tmp = new Vector3();
const ray = new Vector3();

/**
 * Basit ama "oyuncu gibi" davranan bot. Oyuncuyla AYNI sistemleri kullanır:
 * PlayerController'a sanal input verir, AbilitySystem'e niyet (intent) verir.
 *
 * Durumlar:
 *  - engage : tercih edilen mesafede yan adımlarla dolaşır, elemente göre saldırır
 *  - cover  : canı azalınca düşmanın göremeyeceği siper noktasına koşar (yoksa toprak duvar diker)
 *  - recover: arena kenarına yaklaştıysa / boşluğa düşüyorsa merkeze döner (zıplama, dash, rüzgar)
 */
export class BotBrain {
  state: BotState = 'engage';
  private thinkTimer = 0;
  private strafeTimer = 0;
  private strafeDir = 1;
  private coverTimer = 0;
  private coverPoint: Vector3 | null = null;
  private elementTimer = 0;
  private visibleTime = 0;
  private jumpHold = 0;
  private aggressive = true;
  private wantWall = false;
  /** Ana saldırılar arası ek bekleme (zorluk gücüne göre seyrek ateş) */
  private fireGate = 0;
  private preferred: ElementId = 'fire';

  private readonly input: StepInput = { moveX: 0, moveY: 0, held: emptyFlags(), pressed: emptyFlags() };
  private readonly intent: AbilityIntent = {
    selectElement: null,
    cycle: 0,
    primaryPressed: false,
    secondaryPressed: false,
    specialPressed: false,
    primaryHeld: false,
    secondaryHeld: false,
    specialHeld: false,
    interrupt: false,
  };

  constructor(
    private readonly self: Combatant,
    private readonly abilities: AbilitySystem,
    private readonly caster: BotCaster,
    private readonly world: CollisionWorld,
    private readonly projectiles: ProjectileSystem,
    private readonly getTarget: () => Combatant | null,
    private readonly covers: readonly Vector3[],
    private readonly arenaHalf: number,
    public difficulty: BotDifficulty,
  ) {}

  reset(): void {
    this.state = 'engage';
    this.thinkTimer = 0;
    this.coverPoint = null;
    this.visibleTime = 0;
    this.wantWall = false;
    this.elementTimer = 0;
  }

  fixedUpdate(dt: number, active: boolean): void {
    const me = this.self;
    const ctl = me.controller;
    this.clearInput();
    this.fireGate = Math.max(0, this.fireGate - dt);
    if (!me.alive) return;

    const target = this.getTarget();
    if (!active || !target || !target.alive) {
      this.abilities.update(dt, this.intent);
      ctl.moveSpeedMultiplier = 1;
      ctl.fixedUpdate(dt, this.input, ctl.facingYaw);
      return;
    }
    this.caster.target = target;

    // --- Algı
    me.center(myC);
    target.center(tC);
    toT.subVectors(tC, myC);
    const dist = toT.length();
    const hit = this.world.raycast(myC, ray.copy(toT).divideScalar(dist || 1), dist);
    const los = !hit || hit.distance > dist - target.radius;
    this.visibleTime = los ? this.visibleTime + dt : 0;
    const yaw = Math.atan2(-toT.x, -toT.z);

    // --- Karar
    this.thinkTimer -= dt;
    this.strafeTimer -= dt;
    this.elementTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = GameConfig.bot.thinkInterval * this.difficulty.thinkMult * rand(0.8, 1.2);
      this.think(dist, los, target);
    }

    // --- Hareket
    const desired = this.desire(dt, dist, los);
    const dir = this.steer(desired.x, desired.z);
    if (!ctl.grounded && !this.groundBelow()) this.airRecovery(dir);

    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    this.input.moveY = dir.x * fx + dir.z * fz;
    this.input.moveX = dir.x * rx + dir.z * rz;
    this.dodge(dt);
    if (this.jumpHold > 0) {
      this.jumpHold -= dt;
      this.input.held.jump = true;
    }

    // --- Yetenekler
    this.decideAbilities(dist, los);
    if (me.incapacitated) this.clearInput(); // donmuş / havada / yerde sersemken ne hareket ne yetenek
    this.abilities.update(dt, this.intent);
    ctl.moveSpeedMultiplier = this.abilities.moveMultiplier * this.difficulty.speedMult;
    ctl.fixedUpdate(dt, this.input, yaw);
  }

  // ------------------------------------------------------------ karar

  private think(dist: number, los: boolean, target: Combatant): void {
    const B = GameConfig.bot;
    const me = this.self;
    const hpR = me.hp / me.opts.maxHp;
    this.aggressive = Math.random() < this.difficulty.attackChance;

    if (this.nearEdge(B.edgeMargin)) {
      this.state = 'recover';
    } else if (this.state === 'recover' && !this.nearEdge(B.edgeMargin + 3)) {
      this.state = 'engage';
    }

    if (this.state === 'engage' && hpR < B.coverHpThreshold && los && Math.random() < 0.6) {
      const p = findCover(this.covers, this.world, me.position, target.position);
      if (p) {
        this.state = 'cover';
        this.coverPoint = p;
        this.coverTimer = rand(B.coverMinTime, B.coverMaxTime);
      } else {
        this.wantWall = true;
      }
    }

    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(B.strafeMinTime, B.strafeMaxTime);
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }

    // Element seçimi: mesafeye göre, belirli aralıklarla
    if (this.elementTimer <= 0 || this.wantWall) {
      this.elementTimer = rand(B.elementSwitchMinTime, B.elementSwitchMaxTime);
      if (this.wantWall) this.preferred = 'earth';
      else if (dist < 5.5) this.preferred = 'air';
      else if (dist > 16) this.preferred = Math.random() < 0.5 ? 'earth' : 'fire';
      else this.preferred = (['fire', 'water', 'earth', 'fire'] as ElementId[])[Math.floor(Math.random() * 4)];
    }
    // Çok yakına gelindiyse hemen havaya geç (şok dalgası)
    if (dist < 4 && this.abilities.activeElement !== 'air' && Math.random() < 0.5) this.preferred = 'air';
  }

  private desire(dt: number, dist: number, los: boolean): { x: number; z: number } {
    const B = GameConfig.bot;
    const pos = this.self.position;
    if (this.state === 'recover') return this.toCenter();

    if (this.state === 'cover' && this.coverPoint) {
      this.coverTimer -= dt;
      if (this.coverTimer <= 0) {
        this.state = 'engage';
        this.coverPoint = null;
      } else {
        const dx = this.coverPoint.x - pos.x;
        const dz = this.coverPoint.z - pos.z;
        const d = Math.hypot(dx, dz);
        return d < 0.7 ? { x: 0, z: 0 } : { x: dx / d, z: dz / d };
      }
    }

    const hx = toT.x;
    const hz = toT.z;
    const hl = Math.hypot(hx, hz) || 1;
    const nx = hx / hl;
    const nz = hz / hl;
    let radial = 0;
    if (!los) radial = 1;
    else if (dist > B.preferredRange + B.rangeTolerance) radial = 1;
    else if (dist < B.preferredRange - B.rangeTolerance) radial = -1;
    const strafe = los ? this.strafeDir : this.strafeDir * 0.4;
    let x = nx * radial + -nz * strafe;
    let z = nz * radial + nx * strafe;
    const l = Math.hypot(x, z) || 1;
    x /= l;
    z /= l;
    return { x, z };
  }

  private decideAbilities(dist: number, los: boolean): void {
    const A = this.abilities;
    const me = this.self;
    const it = this.intent;
    const el = A.activeElement;
    if (el !== this.preferred && !A.castingAbility) it.selectElement = this.preferred;

    // Siper yoksa toprak duvar: düşmana doğru 4 m öteye
    if (this.wantWall && el === 'earth' && A.canUse('secondary')) {
      const n = Math.hypot(toT.x, toT.z) || 1;
      this.caster.aimOverride = tmp.set(me.position.x + (toT.x / n) * 4, me.position.y, me.position.z + (toT.z / n) * 4).clone();
      it.secondaryPressed = true;
      this.wantWall = false;
      return;
    }

    // Kurtarma: kenardaysa hareket yeteneğiyle merkeze
    if (this.state === 'recover') {
      if ((el === 'water' || el === 'air') && A.canUse('secondary') && this.nearEdge(GameConfig.bot.edgeMargin * 0.6)) {
        const c = this.toCenter();
        this.caster.aimOverride = tmp.set(me.position.x + c.x * 6, me.position.y, me.position.z + c.z * 6).clone();
        it.secondaryPressed = true;
      }
      return;
    }

    const canSee = los && this.visibleTime >= this.difficulty.reactionTime;
    if (!canSee || !this.aggressive) return;

    // Ana saldırı (fireGate: güce göre ateşler arası ek bekleme)
    const ready = A.canUse('primary') && this.fireGate <= 0;
    if (el === 'air') {
      if (dist < 20) it.primaryPressed = ready;
      // Yakında: Rüzgar Patlaması (savurur, yere düşürür)
      if (dist < 5.5 && A.canUse('special') && Math.random() < 0.04) {
        it.specialPressed = true;
        it.primaryPressed = false;
      }
    } else if (dist < 30) {
      it.primaryPressed = ready;
      it.primaryHeld = el === 'water' && ready;
    }
    if (it.primaryPressed) {
      const def = A.slot('primary');
      if (def) this.fireGate = (def.tuning.cooldown + def.tuning.castTime) * this.difficulty.fireIntervalMult;
    }

    // Şifa Suyu (E): canı azalmışken can yenile
    if (el === 'water' && A.canUse('special') && me.hp / me.opts.maxHp < 0.6 && Math.random() < 0.02) {
      this.caster.aimOverride = tC.clone();
      it.specialPressed = true;
      it.primaryPressed = it.primaryHeld = false;
      return;
    }

    // Ateş Nefesi: çok yakındaysa
    if (el === 'fire' && dist < 4.2 && A.canUse('special') && Math.random() < 0.06) {
      this.caster.aimOverride = tC.clone();
      it.specialPressed = true;
      it.primaryPressed = it.primaryHeld = false;
      return;
    }
    // Toprak Zırhı: dövüşte, zırhı yokken
    if (el === 'earth' && me.armor <= 0 && dist < 16 && A.canUse('special') && Math.random() < 0.02) {
      it.specialPressed = true;
    }

    // İkincil
    if (A.canUse('secondary')) {
      if (el === 'fire' && dist < 20 && Math.random() < 0.03) it.secondaryPressed = true;
      else if (el === 'water' && dist > GameConfig.bot.preferredRange + 6 && Math.random() < 0.02) {
        this.caster.aimOverride = tC.clone();
        it.secondaryPressed = true;
      } else if (el === 'air' && dist < 4 && me.hp / me.opts.maxHp < 0.4 && Math.random() < 0.05) {
        // Kaçış sıçrayışı: düşmandan uzağa, merkeze doğru
        const c = this.toCenter();
        this.caster.aimOverride = tmp.set(me.position.x + c.x * 6, me.position.y, me.position.z + c.z * 6).clone();
        it.secondaryPressed = true;
      } else if (el === 'earth' && dist < 14 && Math.random() < 0.004) {
        this.wantWall = true;
      }
    }
  }

  // ------------------------------------------------------------ hareket yardımcıları

  /** İstenen yönü engellere ve boşluğa göre saptır; alçak engelin üstünden zıpla. */
  private steer(x: number, z: number): { x: number; z: number } {
    if (Math.hypot(x, z) < 0.01) return { x: 0, z: 0 };
    const pos = this.self.position;
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = x * c - z * s;
      const dz = x * s + z * c;
      // Boşluk kontrolü (2.5 m'den derin düşüş = güvensiz)
      const g = this.world.groundHeight(pos.x + dx * 1.4, pos.z + dz * 1.4, 0.2, pos.y + 0.5);
      if (!Number.isFinite(g) || g < pos.y - 2.5) continue;
      // Engel kontrolü (diz hizası)
      tmp.set(pos.x, pos.y + 0.3, pos.z);
      const hit = this.world.raycast(tmp, ray.set(dx, 0, dz), 1.3);
      if (hit && hit.box) {
        if (a === 0 && hit.box.maxY - pos.y <= 1.7 && this.self.controller.grounded) {
          this.input.pressed.jump = true;
          this.jumpHold = 0.3;
          return { x: dx, z: dz };
        }
        continue;
      }
      return { x: dx, z: dz };
    }
    return { x: 0, z: 0 };
  }

  /** Havada ve altında zemin yoksa: merkeze dön, hava zıplaması / dash kullan. */
  private airRecovery(dir: { x: number; z: number }): void {
    const ctl = this.self.controller;
    const c = this.toCenter();
    dir.x = c.x;
    dir.z = c.z;
    if (ctl.velocity.y < 0 && ctl.airJumpsLeft > 0) {
      this.input.pressed.jump = true;
      this.jumpHold = 0.3;
    } else if (ctl.airDashesLeft > 0 && ctl.dashCooldown <= 0) {
      this.input.pressed.dash = true;
    }
    // Rüzgar sıçrayışı en güçlü kurtarma
    if (this.abilities.activeElement === 'air' && this.abilities.canUse('secondary')) {
      const p = this.self.position;
      this.caster.aimOverride = tmp.set(p.x + c.x * 6, p.y, p.z + c.z * 6).clone();
      this.intent.secondaryPressed = true;
    } else {
      this.preferred = 'air';
    }
  }

  /** Yaklaşan mermiden kaçınma: yana dash ya da zıplama. */
  private dodge(dt: number): void {
    if (Math.random() > this.difficulty.dodgeChance * dt * 10) return;
    const me = this.self;
    for (const p of this.projectiles.list) {
      if (p.ownerId === me.id) continue;
      tmp.subVectors(me.position, p.position);
      const d = tmp.length();
      if (d > 7 || d < 1) continue;
      if (tmp.dot(p.velocity) / (d * p.velocity.length()) < 0.85) continue;
      const ctl = me.controller;
      if (ctl.dashCooldown <= 0 && Math.random() < 0.6) {
        this.input.pressed.dash = true;
        this.input.moveX = Math.random() < 0.5 ? -1 : 1;
        this.input.moveY = 0;
      } else if (ctl.grounded) {
        this.input.pressed.jump = true;
        this.jumpHold = 0.2;
      }
      return;
    }
  }

  private toCenter(): { x: number; z: number } {
    const p = this.self.position;
    const l = Math.hypot(p.x, p.z) || 1;
    return { x: -p.x / l, z: -p.z / l };
  }

  private nearEdge(margin: number): boolean {
    const p = this.self.position;
    return Math.max(Math.abs(p.x), Math.abs(p.z)) > this.arenaHalf - margin;
  }

  private groundBelow(): boolean {
    const p = this.self.position;
    const g = this.world.groundHeight(p.x, p.z, 0.3, p.y + 0.1);
    return Number.isFinite(g) && g > p.y - 8;
  }

  private clearInput(): void {
    const s = this.input;
    s.moveX = s.moveY = 0;
    for (const k in s.pressed) s.pressed[k as keyof typeof s.pressed] = false;
    for (const k in s.held) s.held[k as keyof typeof s.held] = false;
    const it = this.intent;
    it.selectElement = null;
    it.cycle = 0;
    it.primaryPressed = it.secondaryPressed = it.specialPressed = it.primaryHeld = it.interrupt = false;
  }
}
