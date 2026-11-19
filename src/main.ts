import './style.css';
import * as THREE from 'three';
import { GameConfig } from './config/gameConfig';
import { DefaultArena } from './config/arenaLayout';
import { CollisionWorld } from './physics/CollisionWorld';
import { PlayerController } from './game/PlayerController';
import { ThirdPersonCamera } from './game/ThirdPersonCamera';
import { PlayerCaster } from './game/PlayerCaster';
import { InputManager } from './input/InputManager';
import type { Action, StepInput } from './input/InputActions';
import { GameRenderer } from './render/GameRenderer';
import { buildArenaView } from './render/ArenaView';
import { PlayerView } from './render/PlayerView';
import { EffectsView } from './render/EffectsView';
import { Hud } from './ui/Hud';
import { AbilityBar } from './ui/AbilityBar';
import { EventBus } from './core/EventBus';
import { lerpAngle } from './core/math';
import { AbilitySystem, type AbilityIntent } from './abilities/AbilitySystem';
import { createDefaultRegistry } from './abilities/AbilityRegistry';
import { ELEMENTS, ELEMENT_ORDER, type ElementId } from './abilities/elements';
import type { GameEvents } from './abilities/types';
import { Combatant } from './combat/Combatant';
import { ProjectileSystem } from './combat/ProjectileSystem';
import { WallSystem } from './combat/WallSystem';
import type { GameServices } from './game/GameServices';
import { ProjectileView } from './render/ProjectileView';
import { WallView } from './render/WallView';
import { WorldOverlay } from './ui/WorldOverlay';

/**
 * Bootstrap + oyun döngüsü.
 * Katmanlar:  input/ (cihaz)  →  game/ + physics/ + abilities/ (saf mantık, sabit adım)  →  render/ + ui/ (görsel)
 * Mantık → görsel iletişimi EventBus üzerinden; Capacitor/PWA'da yalnızca input/render katmanları uyarlanır.
 */
const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const isTouch = params.has('touch') || window.matchMedia('(pointer: coarse)').matches;
const showDebug = !isTouch || params.has('debug');
document.body.classList.toggle('is-touch', isTouch);

// --- Mantık
const bus = new EventBus<GameEvents>();
const world = new CollisionWorld(DefaultArena);
const spawn = DefaultArena.spawnPoints[0];
const player = new PlayerController(world, spawn);
const camera = new ThirdPersonCamera(world);
camera.yaw = spawn.yaw;
const combatants: Combatant[] = [];
const walls = new WallSystem(world, bus, combatants);
const projectiles = new ProjectileSystem(world, bus, combatants, walls);
const services: GameServices = { world, bus, combatants, projectiles, walls };

const playerCombatant = new Combatant('player', player, bus, { maxHp: GameConfig.combat.playerMaxHp, respawnDelay: null }, spawn);
combatants.push(playerCombatant);
DefaultArena.dummySpawns.forEach((s, i) => {
  combatants.push(
    new Combatant(`dummy${i + 1}`, new PlayerController(world, s), bus, {
      maxHp: GameConfig.combat.dummyMaxHp,
      respawnDelay: GameConfig.combat.dummyRespawnDelay,
      dummy: true,
    }, s),
  );
});
const dummies = combatants.filter((c) => c.opts.dummy);

const registry = createDefaultRegistry();
const abilities = new AbilitySystem(new PlayerCaster('player', player, camera), registry, services);

// --- Render
const gfx = new GameRenderer(app, isTouch);
gfx.scene.add(buildArenaView(DefaultArena));
const playerView = new PlayerView(gfx.scene);
const dummyViews = dummies.map(() => new PlayerView(gfx.scene, 0xe0603a));
const effects = new EffectsView(gfx.scene, bus);
const projectileView = new ProjectileView(gfx.scene, projectiles);
const wallView = new WallView(gfx.scene, walls);
const overlay = new WorldOverlay(app, bus, 'player');

const aimMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xff5a5a, depthTest: false, transparent: true, opacity: 0.85 }),
);
aimMarker.renderOrder = 10;
gfx.scene.add(aimMarker);

// --- Input + HUD
let input: InputManager;
const hud = new Hud(app, { touch: isTouch, debug: showDebug, onStart: () => input.keyboardMouse.requestLock() });
const abilityBar = new AbilityBar(app, {
  touch: isTouch,
  onSelectElement: (e) => {
    const a = `element${ELEMENT_ORDER.indexOf(e) + 1}` as Action;
    input.press(a);
    input.release(a);
  },
});
input = new InputManager(app, gfx.canvas, {
  touch: isTouch,
  onPointerLockChange: (locked) => hud.setPointerLocked(locked),
});

function refreshTouchLabels(): void {
  const color = ELEMENTS[abilities.activeElement].css;
  input.touch?.setButton('primary', abilities.slot('primary')?.name ?? '—', color);
  input.touch?.setButton('secondary', abilities.slot('secondary')?.name ?? '—', color);
}
refreshTouchLabels();
bus.on('element:changed', refreshTouchLabels);
bus.on('combat:damage', (e) => {
  if (e.sourceId === 'player') hud.hitMarker(e.killed);
});
bus.on('ability:denied', (e) => {
  if (e.casterId !== 'player') return;
  abilityBar.flashDenied(e.slot);
  input.touch?.flash(e.slot);
});

// --- Input → yetenek niyeti
const intent: AbilityIntent = {
  selectElement: null,
  cycle: 0,
  primaryPressed: false,
  secondaryPressed: false,
  primaryHeld: false,
  interrupt: false,
};

function toIntent(s: StepInput): AbilityIntent {
  let select: ElementId | null = null;
  for (let i = 0; i < ELEMENT_ORDER.length; i++) {
    if (s.pressed[`element${i + 1}` as Action]) select = ELEMENT_ORDER[i];
  }
  intent.selectElement = select;
  intent.cycle = (s.pressed.elementNext ? 1 : 0) - (s.pressed.elementPrev ? 1 : 0);
  intent.primaryPressed = s.pressed.primary;
  intent.secondaryPressed = s.pressed.secondary;
  intent.primaryHeld = s.held.primary;
  intent.interrupt = GameConfig.abilities.cancelCastOnDash && (s.pressed.dash || player.dashing);
  return intent;
}

// --- Döngü (sabit fizik adımı + render interpolasyonu)
const STEP = 1 / GameConfig.physics.fixedHz;
let accumulator = 0;
let last = performance.now();
let fps = 60;
const renderPos = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

function fixedStep(): void {
  const s = input.sampleStep();
  if (s.pressed.reset) abilities.reset();
  // Sıra: yapılar (yükselen sütunlar) → yetenekler → hareket → kuklalar → mermiler
  walls.update(STEP);
  abilities.update(STEP, toIntent(s));
  player.moveSpeedMultiplier = abilities.moveMultiplier;
  const prevY = player.position.y;
  player.fixedUpdate(STEP, s, camera.yaw);
  // Işınlanma (respawn) olduysa kamerayı yumuşatmadan oturt
  if (Math.abs(player.position.y - prevY) > 5) camera.snap();
  for (const c of combatants) c.fixedUpdate(STEP, player.position);
  projectiles.update(STEP);
}

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

  const look = input.consumeLook();
  camera.applyLook(look.dx, look.dy);

  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < GameConfig.physics.maxStepsPerFrame) {
    fixedStep();
    accumulator -= STEP;
    steps++;
  }
  if (steps === GameConfig.physics.maxStepsPerFrame) accumulator = 0;

  const alpha = accumulator / STEP;
  renderPos.lerpVectors(player.prevPosition, player.position, alpha);
  const ratio = player.prevHeightRatio + (player.heightRatio - player.prevHeightRatio) * alpha;
  const yaw = lerpAngle(player.prevFacingYaw, player.facingYaw, alpha);

  camera.update(dt, renderPos, ratio);
  gfx.setCameraPose(camera.position, camera.yaw, camera.pitch);
  const casting = abilities.castingAbility;
  playerView.update(
    renderPos,
    yaw,
    ratio,
    player.dashing,
    camera.currentDistance,
    ELEMENTS[abilities.activeElement].color,
    casting ? Math.max(0.01, abilities.castProgress) : 0,
  );
  dummies.forEach((d, i) => {
    const v = dummyViews[i];
    v.root.visible = d.alive;
    if (!d.alive) return;
    const c = d.controller;
    tmpPos.lerpVectors(c.prevPosition, c.position, alpha);
    v.update(tmpPos, lerpAngle(c.prevFacingYaw, c.facingYaw, alpha), c.heightRatio, false, 10, d.hitFlash > 0 ? 0xffffff : 0x331a10, d.hitFlash > 0 ? 1 : 0);
  });
  aimMarker.position.copy(camera.aimPoint);
  aimMarker.visible = camera.aimHit;
  effects.update(dt);
  projectileView.update(dt, alpha);
  wallView.update();
  overlay.update(dt, gfx.camera, combatants, alpha, window.innerWidth, window.innerHeight);

  const dashCd = player.dashCooldown / GameConfig.dash.cooldown;
  const slideCd = player.slideCooldown / GameConfig.slide.cooldown;
  hud.update(
    {
      fps,
      speed: player.horizontalSpeed,
      state: player.state,
      dashCd,
      slideCd,
      airJumps: player.airJumpsLeft,
      airDashes: player.airDashesLeft,
      pos: player.position,
    },
    now,
  );
  abilityBar.update(abilities);
  if (input.touch) {
    input.touch.setCooldown('dash', dashCd);
    input.touch.setCooldown('slide', slideCd);
    const p = abilities.slot('primary');
    const sec = abilities.slot('secondary');
    input.touch.setCooldown('primary', p ? abilities.cooldownRatio(p) : 0);
    input.touch.setCooldown('secondary', sec ? abilities.cooldownRatio(sec) : 0);
  }

  gfx.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Tarayıcı konsolundan hata ayıklama için
Object.assign(window as unknown as Record<string, unknown>, {
  __game: { player, camera, world, input, abilities, registry, bus, services, config: GameConfig, fixedStep },
});
