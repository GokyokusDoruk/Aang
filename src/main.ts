import './style.css';
import * as THREE from 'three';
import { GameConfig } from './config/gameConfig';
import { DefaultArena } from './config/arenaLayout';
import { CollisionWorld } from './physics/CollisionWorld';
import { PlayerController } from './game/PlayerController';
import { ThirdPersonCamera } from './game/ThirdPersonCamera';
import { InputManager } from './input/InputManager';
import { GameRenderer } from './render/GameRenderer';
import { buildArenaView } from './render/ArenaView';
import { PlayerView } from './render/PlayerView';
import { Hud } from './ui/Hud';
import { lerpAngle } from './core/math';

/**
 * Bootstrap + oyun döngüsü.
 * Katmanlar:  input/ (cihaz)  →  game/ + physics/ (saf mantık, sabit adım)  →  render/ + ui/ (görsel)
 * Bu ayrım sayesinde Capacitor/PWA paketlemesinde yalnızca input/render katmanları uyarlanır.
 */
const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const isTouch = params.has('touch') || window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('is-touch', isTouch);

// --- Mantık
const world = new CollisionWorld(DefaultArena);
const spawn = DefaultArena.spawnPoints[0];
const player = new PlayerController(world, spawn);
const camera = new ThirdPersonCamera(world);
camera.yaw = spawn.yaw;

// --- Render
const gfx = new GameRenderer(app, isTouch);
gfx.scene.add(buildArenaView(DefaultArena));
const playerView = new PlayerView(gfx.scene);

const aimMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0xff5a5a, depthTest: false, transparent: true, opacity: 0.85 }),
);
aimMarker.renderOrder = 10;
gfx.scene.add(aimMarker);

// --- Input + HUD
let input: InputManager;
const hud = new Hud(app, { touch: isTouch, onStart: () => input.keyboardMouse.requestLock() });
input = new InputManager(app, gfx.canvas, {
  touch: isTouch,
  onPointerLockChange: (locked) => hud.setPointerLocked(locked),
});

// --- Döngü (sabit fizik adımı + render interpolasyonu)
const STEP = 1 / GameConfig.physics.fixedHz;
let accumulator = 0;
let last = performance.now();
let fps = 60;
const renderPos = new THREE.Vector3();

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

  const look = input.consumeLook();
  camera.applyLook(look.dx, look.dy);

  accumulator += dt;
  let steps = 0;
  while (accumulator >= STEP && steps < GameConfig.physics.maxStepsPerFrame) {
    const prevY = player.position.y;
    player.fixedUpdate(STEP, input.sampleStep(), camera.yaw);
    // Işınlanma (respawn) olduysa kamerayı yumuşatmadan oturt
    if (Math.abs(player.position.y - prevY) > 5) camera.snap();
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
  playerView.update(renderPos, yaw, ratio, player.dashing, camera.currentDistance);
  aimMarker.position.copy(camera.aimPoint);
  aimMarker.visible = camera.aimHit;

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
  input.touch?.setCooldown('dash', dashCd);
  input.touch?.setCooldown('slide', slideCd);

  gfx.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Tarayıcı konsolundan hata ayıklama için
Object.assign(window as unknown as Record<string, unknown>, { __game: { player, camera, world, input, config: GameConfig } });
