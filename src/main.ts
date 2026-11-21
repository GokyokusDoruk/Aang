import './style.css';
import * as THREE from 'three';
import { GameConfig } from './config/gameConfig';
import { DefaultArena } from './config/arenaLayout';
import { GameSession, type Difficulty, type GameMode } from './game/GameSession';
import { InputManager } from './input/InputManager';
import type { Action } from './input/InputActions';
import { GameRenderer } from './render/GameRenderer';
import { buildArenaView } from './render/ArenaView';
import { ArenaDecor } from './render/ArenaDecor';
import { CrateView } from './render/CrateView';
import { GameFeel } from './render/GameFeel';
import { PlayerView, type FighterMotion } from './render/PlayerView';
import { loadCharacterAsset } from './render/CharacterAsset';
import { EffectsView } from './render/EffectsView';
import { ProjectileView } from './render/ProjectileView';
import { WallView } from './render/WallView';
import { IcePathView } from './render/IcePathView';
import { TrailView } from './render/TrailView';
import { Hud } from './ui/Hud';
import { AbilityBar } from './ui/AbilityBar';
import { WorldOverlay } from './ui/WorldOverlay';
import { PlayerStatus } from './ui/PlayerStatus';
import { MatchHud } from './ui/MatchHud';
import { abilityIcon } from './ui/icons';
import { ABILITY_SLOTS } from './abilities/types';
import { SoundSystem } from './audio/SoundSystem';
import { Menu } from './ui/Menu';
import { lerpAngle } from './core/math';
import { ELEMENTS, ELEMENT_ORDER } from './abilities/elements';
import { raycastCombatants } from './combat/targeting';
import type { Combatant } from './combat/Combatant';

/**
 * İstemci: input → GameSession (saf mantık, sabit adım) → render + UI.
 * Platform bağımlı her şey (DOM, WebGL, pointer-lock, dokunmatik) burada ve render/ui/input katmanlarında.
 */
const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const isTouch = params.has('touch') || window.matchMedia('(pointer: coarse)').matches;
// FPS / durum paneli yalnızca geliştirme için: adrese ?debug eklenince görünür
const showDebug = params.has('debug');
document.body.classList.toggle('is-touch', isTouch);

// --- Mantık
const session = new GameSession(DefaultArena);
const { bus, player, playerCtl, playerAbilities: abilities, bot, camera } = session;
camera.yaw = DefaultArena.spawnPoints[0].yaw;
camera.aimProbe = (o, d, max) => raycastCombatants(o, d, max, session.combatants, 'player');

// --- Render
const gfx = new GameRenderer(app, isTouch);
gfx.scene.add(buildArenaView(DefaultArena));
const decor = new ArenaDecor(DefaultArena, isTouch);
gfx.scene.add(decor.group);
const playerView = new PlayerView(gfx.scene);
const botView = new PlayerView(gfx.scene, 0x9b5cff);
const dummyViews = session.dummies.map(() => new PlayerView(gfx.scene, 0xe0603a));
// Hazır karakter modeli (public/models/character.glb) varsa prosedürel karakterin yerine geçer
void loadCharacterAsset(GameConfig.player.height).then((asset) => {
  if (asset) for (const v of [playerView, botView, ...dummyViews]) v.attachModel(asset);
});
const effects = new EffectsView(gfx.scene, bus, isTouch ? GameConfig.render.mobileEffectScale : 1);
const projectileView = new ProjectileView(gfx.scene, session.projectiles);
const icePathView = new IcePathView(gfx.scene, session.icePaths);
const wallView = new WallView(gfx.scene, session.walls, (pts, el) => el === 'earth' && effects.earthEruption(pts));
const trailView = new TrailView(gfx.scene);
const crateView = new CrateView(gfx.scene, session.crates);
const feel = new GameFeel(
  app,
  bus,
  effects,
  () =>
    session.running
      ? [
          { c: player, element: () => abilities.activeElement },
          ...(session.mode === 'match' ? [{ c: bot, element: () => session.botAbilities.activeElement }] : []),
        ]
      : [],
  () => playerCtl.position,
);
// Yetenek çıktığı an karakter vuruş hamlesi yapar
bus.on('ability:cast', (e) => {
  if (e.casterId === 'player') playerView.triggerCast();
  else if (e.casterId === 'bot') botView.triggerCast();
});

const aimMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xff5a5a, depthTest: false, transparent: true, opacity: 0.85 }),
);
aimMarker.renderOrder = 10;
gfx.scene.add(aimMarker);

// --- UI
const overlay = new WorldOverlay(app, bus, 'player');
const hud = new Hud(app, { touch: isTouch, debug: showDebug });
let input: InputManager;
const abilityBar = new AbilityBar(app, {
  touch: isTouch,
  onSelectElement: (e) => {
    const a = `element${ELEMENT_ORDER.indexOf(e) + 1}` as Action;
    input.press(a);
    input.release(a);
  },
});
const playerStatus = new PlayerStatus(app, bus, player, isTouch);
const matchHud = new MatchHud(app, bus, session.round, bot, isTouch);
const sound = new SoundSystem(bus, 'player');

// --- Oturum akışı (menü / duraklat / yeniden başlat)
let lastMode: GameMode = 'match';
let lastDiff: Difficulty = 'normal';

function lockPointer(): void {
  if (!isTouch) input.keyboardMouse.requestLock();
}

function startGame(mode: GameMode, diff: Difficulty): void {
  lastMode = mode;
  lastDiff = diff;
  session.start(mode, diff);
  camera.yaw = DefaultArena.spawnPoints[0].yaw;
  camera.pitch = GameConfig.camera.defaultPitch;
  camera.snap();
  matchHud.setVisible(mode === 'match');
  menu.hide();
  lockPointer();
}

function pause(): void {
  if (!session.running || menu.visible) return;
  session.paused = true;
  menu.showPause();
}

const menu = new Menu(app, isTouch, {
  onStart: startGame,
  onResume: () => {
    session.paused = false;
    menu.hide();
    lockPointer();
  },
  onRestart: () => startGame(lastMode, lastDiff),
  onMainMenu: () => {
    session.stop();
    matchHud.setVisible(false);
    menu.showMain();
  },
});

// Menüde ses aç/kapa düğmesi (M tuşuyla da çalışır)
const soundBtn = document.createElement('button');
soundBtn.className = 'sound-toggle';
soundBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sound.setMuted(!sound.isMuted);
});
sound.onMuteChange((m) => {
  soundBtn.textContent = m ? '🔇 Ses kapalı' : '🔊 Ses açık';
});
menu.attach(soundBtn);

input = new InputManager(app, gfx.canvas, {
  touch: isTouch,
  // Masaüstü: fare kilidi kalkınca (Esc) oyunu duraklat
  onPointerLockChange: (locked) => {
    if (!locked) pause();
  },
});
// Oyun alanına tıklayınca kilidi yeniden al (menü açık değilse)
gfx.canvas.addEventListener('click', () => {
  if (!menu.visible) lockPointer();
});

function refreshTouchLabels(): void {
  const color = ELEMENTS[abilities.activeElement].css;
  for (const slot of ABILITY_SLOTS) {
    const def = abilities.slot(slot);
    input.touch?.setButton(slot, def?.name ?? '—', color, def ? abilityIcon(def.id, abilities.activeElement) : '');
    input.touch?.setEmpty(slot, !def);
  }
}
refreshTouchLabels();
bus.on('element:changed', (e) => e.casterId === 'player' && refreshTouchLabels());
bus.on('combat:damage', (e) => {
  if (e.sourceId === 'player' && e.targetId !== 'player' && e.kind !== 'burn') hud.hitMarker(e.killed);
  if (e.targetId === 'player' && isTouch && e.kind !== 'burn') navigator.vibrate?.(35);
});
bus.on('combat:respawn', (e) => {
  if (e.targetId === 'player') camera.snap();
});
bus.on('ability:denied', (e) => {
  if (e.casterId !== 'player') return;
  abilityBar.flashDenied(e.slot);
  input.touch?.flash(e.slot);
});
bus.on('round:phase', (e) => {
  if (e.phase === 'matchEnd') {
    session.paused = true;
    if (!isTouch && document.pointerLockElement) document.exitPointerLock();
    menu.showMatchEnd(e.winnerId === 'player', e.scores.player ?? 0, e.scores.bot ?? 0);
  }
});

// --- Döngü (sabit fizik adımı + render interpolasyonu)
const STEP = 1 / GameConfig.physics.fixedHz;
let accumulator = 0;
let last = performance.now();
let fps = 60;
const renderPos = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

function drawFighter(view: PlayerView, c: Combatant, alpha: number, now: number, elementColor: number, castProgress: number): void {
  const blink = c.spawnProtected && Math.floor(now / 90) % 2 === 0;
  view.root.visible = c.alive && !blink;
  if (!c.alive) return;
  const ctl = c.controller;
  tmpPos.lerpVectors(ctl.prevPosition, ctl.position, alpha);
  const ratio = ctl.prevHeightRatio + (ctl.heightRatio - ctl.prevHeightRatio) * alpha;
  const flash = c.hitFlash > 0;
  view.update(tmpPos, lerpAngle(ctl.prevFacingYaw, ctl.facingYaw, alpha), ratio, ctl.dashing, 10, elementColor, castProgress, motionOf(ctl), frameDt, flash, chillOf(c), c.burning, c.downedPose);
}

/** El parlaması / hazırlık pozu: normal hazırlık ya da süren uzun basış (şarj dolarken artar). */
function castVisual(a: typeof abilities): number {
  const ch = a.chargedActive;
  if (ch) return ch.charged.kind === 'charge' ? Math.max(0.15, ch.progress) : 1;
  return a.castingAbility ? Math.max(0.01, a.castProgress) : 0;
}

/** Üşüme görseli: 0..1, donmuşken 1 */
function chillOf(c: Combatant): number {
  return c.frozenTimer > 0 ? 1 : (c.chillStacks / GameConfig.water.chill.maxStacks) * 0.99;
}

function motionOf(ctl: Combatant['controller']): FighterMotion {
  return { velocity: ctl.velocity, grounded: ctl.grounded, state: ctl.state };
}

let frameDt = 1 / 60;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  frameDt = dt;
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;
  gfx.adapt(fps, dt);

  const look = input.consumeLook();
  const active = session.running && !session.paused;
  if (active) camera.applyLook(look.dx, look.dy);

  if (active) {
    accumulator += dt * feel.simScale(dt);
    let steps = 0;
    while (accumulator >= STEP && steps < GameConfig.physics.maxStepsPerFrame) {
      const s = input.sampleStep();
      if (s.pressed.pause) pause();
      session.fixedStep(STEP, s, camera.yaw);
      accumulator -= STEP;
      steps++;
    }
    if (steps === GameConfig.physics.maxStepsPerFrame) accumulator = 0;
  } else {
    accumulator = 0;
    const s = input.sampleStep(); // menüdeyken birikmiş basışları at
    void s;
  }

  const alpha = accumulator / STEP;
  renderPos.lerpVectors(playerCtl.prevPosition, playerCtl.position, alpha);
  const ratio = playerCtl.prevHeightRatio + (playerCtl.heightRatio - playerCtl.prevHeightRatio) * alpha;
  camera.update(dt, renderPos, ratio);
  gfx.setCameraPose(camera.position, camera.yaw, camera.pitch);
  feel.update(dt, gfx.camera, playerCtl.dashing, playerCtl.horizontalSpeed);

  // Oyuncu (kendi görünümü kamera mesafesine göre saydamlaşır)
  const blink = player.spawnProtected && Math.floor(now / 90) % 2 === 0;
  playerView.root.visible = session.running && player.alive && !blink;
  playerView.update(
    renderPos,
    lerpAngle(playerCtl.prevFacingYaw, playerCtl.facingYaw, alpha),
    ratio,
    playerCtl.dashing,
    camera.currentDistance,
    ELEMENTS[abilities.activeElement].color,
    castVisual(abilities),
    motionOf(playerCtl),
    dt,
    player.hitFlash > 0,
    chillOf(player),
    player.burning,
    player.downedPose,
  );

  const inMatch = session.running && session.mode === 'match';
  const inTraining = session.running && session.mode === 'training';
  if (inMatch) {
    const ba = session.botAbilities;
    drawFighter(botView, bot, alpha, now, ELEMENTS[ba.activeElement].color, castVisual(ba));
  } else botView.root.visible = false;
  session.dummies.forEach((d, i) => {
    if (inTraining) drawFighter(dummyViews[i], d, alpha, now, 0x331a10, 0);
    else dummyViews[i].root.visible = false;
  });

  aimMarker.position.copy(camera.aimPoint);
  aimMarker.visible = active && camera.aimHit;
  effects.update(dt);
  projectileView.update(dt, alpha);
  wallView.update();
  icePathView.update(dt);
  crateView.update();
  decor.update(dt);
  trailView.update(dt, session.combatants);
  overlay.update(dt, gfx.camera, session.combatants, alpha, window.innerWidth, window.innerHeight);

  const dashCd = playerCtl.dashCooldown / GameConfig.dash.cooldown;
  const slideCd = playerCtl.slideCooldown / GameConfig.slide.cooldown;
  hud.update(
    {
      fps,
      speed: playerCtl.horizontalSpeed,
      state: playerCtl.state,
      dashCd,
      slideCd,
      airJumps: playerCtl.airJumpsLeft,
      airDashes: playerCtl.airDashesLeft,
      pos: playerCtl.position,
    },
    now,
  );
  abilityBar.update(abilities);
  playerStatus.update(dt);
  if (inMatch) matchHud.update(dt);
  sound.update(gfx.camera, menu.visible ? null : playerCtl, inMatch ? session.round : null);
  if (input.touch) {
    input.touch.setCooldown('dash', dashCd);
    input.touch.setCooldown('slide', slideCd);
    for (const slot of ABILITY_SLOTS) {
      const def = abilities.slot(slot);
      input.touch.setCooldown(slot, def ? abilities.cooldownRatio(def) : 0);
      input.touch.setHoldCooldown(slot, def?.charged ? abilities.chargedCooldownRatio(def) : null);
    }
  }

  gfx.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Tarayıcı konsolundan hata ayıklama / test için
Object.assign(window as unknown as Record<string, unknown>, {
  __game: { session, camera, input, menu, matchHud, config: GameConfig, startGame, playerView, effects },
});
