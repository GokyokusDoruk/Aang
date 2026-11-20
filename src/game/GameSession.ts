import { GameConfig } from '../config/gameConfig';
import type { ArenaLayout } from '../config/arenaLayout';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { CollisionWorld } from '../physics/CollisionWorld';
import { Combatant } from '../combat/Combatant';
import { ProjectileSystem } from '../combat/ProjectileSystem';
import { WallSystem } from '../combat/WallSystem';
import { CrateSystem } from '../combat/CrateSystem';
import { AbilitySystem, type AbilityIntent } from '../abilities/AbilitySystem';
import { createDefaultRegistry, type AbilityRegistry } from '../abilities/AbilityRegistry';
import { ELEMENT_ORDER, type ElementId } from '../abilities/elements';
import { emptyFlags, type Action, type StepInput } from '../input/InputActions';
import { BotBrain } from '../ai/BotBrain';
import { BotCaster } from '../ai/BotCaster';
import { buildCoverPoints } from '../ai/coverPoints';
import { PlayerController } from './PlayerController';
import { PlayerCaster } from './PlayerCaster';
import { RoundManager } from './RoundManager';
import type { GameServices } from './GameServices';
import { ThirdPersonCamera } from './ThirdPersonCamera';

export type GameMode = 'training' | 'match';
export type Difficulty = keyof typeof GameConfig.botDifficulty;

const FROZEN: StepInput = { moveX: 0, moveY: 0, held: emptyFlags(), pressed: emptyFlags() };

/**
 * Tüm oyun mantığı (DOM ve sahne yok): dünya, sistemler, dövüşçüler, bot, raundlar.
 * main.ts yalnızca input verir, render alır. Aynı sınıf ileride sunucu / ağ tarafında da çalışabilir.
 */
export class GameSession {
  readonly bus = new EventBus<GameEvents>();
  readonly world: CollisionWorld;
  readonly combatants: Combatant[] = [];
  readonly walls: WallSystem;
  readonly crates: CrateSystem;
  readonly projectiles: ProjectileSystem;
  readonly services: GameServices;
  readonly registry: AbilityRegistry;

  readonly playerCtl: PlayerController;
  readonly player: Combatant;
  readonly playerAbilities: AbilitySystem;

  readonly bot: Combatant;
  readonly botAbilities: AbilitySystem;
  readonly botBrain: BotBrain;

  readonly dummies: Combatant[];
  readonly round: RoundManager;

  mode: GameMode = 'training';
  difficulty: Difficulty = 'normal';
  running = false;
  paused = false;

  private readonly intent: AbilityIntent = {
    selectElement: null,
    cycle: 0,
    primaryPressed: false,
    secondaryPressed: false,
    primaryHeld: false,
    interrupt: false,
  };

  /** Oyuncunun kamera rig'i (nişan noktası yetenekler tarafından kullanılır). */
  readonly camera: ThirdPersonCamera;

  constructor(layout: ArenaLayout) {
    const bus = this.bus;
    this.world = new CollisionWorld(layout);
    const camera = (this.camera = new ThirdPersonCamera(this.world));
    this.walls = new WallSystem(this.world, bus, this.combatants);
    this.crates = new CrateSystem(this.world, bus, layout.crates);
    this.walls.extraDamage = (box, amount, point) => this.crates.damageByBox(box, amount, point);
    this.projectiles = new ProjectileSystem(this.world, bus, this.combatants, this.walls);
    this.services = { world: this.world, bus, combatants: this.combatants, projectiles: this.projectiles, walls: this.walls };
    this.registry = createDefaultRegistry();

    const [pSpawn, bSpawn] = layout.spawnPoints;
    this.playerCtl = new PlayerController(this.world, pSpawn);
    this.player = new Combatant('player', this.playerCtl, bus, { maxHp: GameConfig.combat.playerMaxHp, respawnDelay: null }, pSpawn);
    this.playerAbilities = new AbilitySystem(new PlayerCaster('player', this.playerCtl, camera), this.registry, this.services);

    this.bot = new Combatant('bot', new PlayerController(this.world, bSpawn), bus, { maxHp: GameConfig.combat.playerMaxHp, respawnDelay: null }, bSpawn);
    const botCaster = new BotCaster('bot', this.bot, () => GameConfig.botDifficulty[this.difficulty]);
    this.botAbilities = new AbilitySystem(botCaster, this.registry, this.services, 'fire');
    this.botBrain = new BotBrain(
      this.bot,
      this.botAbilities,
      botCaster,
      this.world,
      this.projectiles,
      () => this.player,
      buildCoverPoints(layout, this.world),
      layout.size / 2,
      GameConfig.botDifficulty.normal,
    );

    this.dummies = layout.dummySpawns.map(
      (s, i) =>
        new Combatant(
          `dummy${i + 1}`,
          new PlayerController(this.world, s),
          bus,
          { maxHp: GameConfig.combat.dummyMaxHp, respawnDelay: GameConfig.combat.dummyRespawnDelay, dummy: true },
          s,
        ),
    );

    this.round = new RoundManager(bus, () => [this.player, this.bot], () => this.resetRound());
  }

  /** Yeni oturum: antrenman (kuklalar) ya da bota karşı maç. */
  start(mode: GameMode, difficulty: Difficulty = this.difficulty): void {
    this.mode = mode;
    this.difficulty = difficulty;
    this.botBrain.difficulty = GameConfig.botDifficulty[difficulty];
    this.combatants.length = 0;
    this.combatants.push(this.player);
    if (mode === 'match') this.combatants.push(this.bot);
    else this.combatants.push(...this.dummies);

    this.player.opts.respawnDelay = mode === 'training' ? GameConfig.combat.playerRespawnDelay : null;
    this.running = true;
    this.paused = false;

    if (mode === 'match') {
      this.round.startMatch();
    } else {
      this.round.stop();
      this.resetRound();
      for (const d of this.dummies) d.respawn();
    }
  }

  /** Ana menüye dönüş */
  stop(): void {
    this.running = false;
    this.paused = false;
    this.round.stop();
  }

  /** Raund başı: alanı temizle, dövüşçüleri doğuş noktalarına koy. */
  private resetRound(): void {
    this.walls.clear();
    this.crates.reset();
    this.projectiles.clear();
    this.player.respawn();
    this.playerAbilities.reset();
    if (this.mode === 'match') {
      this.bot.respawn();
      this.botAbilities.reset();
      this.botBrain.reset();
    }
  }

  get fighting(): boolean {
    return this.mode === 'training' || this.round.phase === 'fight';
  }

  fixedStep(dt: number, s: StepInput, cameraYaw: number): void {
    if (!this.running || this.paused) return;
    const fighting = this.fighting;

    if (s.pressed.reset && this.mode === 'training') {
      this.player.respawn();
      this.playerAbilities.reset();
    }

    // Sıra: yapılar → oyuncu → bot → dövüşçü durumları → mermiler → raund
    this.walls.update(dt);
    this.crates.update(dt);

    if (this.player.alive) {
      const inp = fighting && this.player.frozenTimer <= 0 ? s : FROZEN;
      this.playerAbilities.update(dt, this.toIntent(inp));
      this.playerCtl.moveSpeedMultiplier = this.playerAbilities.moveMultiplier;
      this.playerCtl.fixedUpdate(dt, inp, cameraYaw);
    } else {
      this.playerAbilities.reset();
      this.playerCtl.prevPosition.copy(this.playerCtl.position);
    }

    if (this.mode === 'match') this.botBrain.fixedUpdate(dt, fighting);

    for (const c of this.combatants) c.fixedUpdate(dt, this.playerCtl.position);
    this.projectiles.update(dt);
    if (this.mode === 'match') this.round.update(dt);
  }

  private toIntent(s: StepInput): AbilityIntent {
    let select: ElementId | null = null;
    for (let i = 0; i < ELEMENT_ORDER.length; i++) {
      if (s.pressed[`element${i + 1}` as Action]) select = ELEMENT_ORDER[i];
    }
    const it = this.intent;
    it.selectElement = select;
    it.cycle = (s.pressed.elementNext ? 1 : 0) - (s.pressed.elementPrev ? 1 : 0);
    it.primaryPressed = s.pressed.primary;
    it.secondaryPressed = s.pressed.secondary;
    it.primaryHeld = s.held.primary;
    it.interrupt = GameConfig.abilities.cancelCastOnDash && (s.pressed.dash || this.playerCtl.dashing);
    return it;
  }
}
