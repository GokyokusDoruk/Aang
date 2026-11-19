import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';

/** WebGL renderer, sahne, ışıklar, kamera ve responsive boyutlandırma. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  constructor(container: HTMLElement, mobile: boolean) {
    const R = GameConfig.render;
    const C = GameConfig.camera;

    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? R.mobileMaxPixelRatio : R.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = R.shadows;
    this.renderer.shadowMap.type = mobile ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(R.skyColor);
    this.scene.fog = new THREE.Fog(R.skyColor, R.fogNear, R.fogFar);

    this.camera = new THREE.PerspectiveCamera(C.fov, 1, C.near, C.far);
    this.camera.rotation.order = 'YXZ';

    const hemi = new THREE.HemisphereLight(0xdfefff, 0x3a3328, 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    sun.position.set(18, 34, 12);
    sun.castShadow = R.shadows;
    const size = mobile ? R.mobileShadowMapSize : R.shadowMapSize;
    sun.shadow.mapSize.set(size, size);
    const s = sun.shadow.camera;
    s.left = -28;
    s.right = 28;
    s.top = 28;
    s.bottom = -28;
    s.near = 1;
    s.far = 90;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const resize = () => this.resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 150));
    this.resize();
  }

  private lowFpsTime = 0;

  /**
   * Uyarlamalı kalite: FPS uzun süre düşük kalırsa çözünürlüğü kademeli düşür
   * (mobil tarayıcılarda ısınma / düşük güç modunda akıcılığı korur).
   */
  adapt(fps: number, dt: number): void {
    const R = GameConfig.render;
    if (fps < R.adaptiveMinFps) this.lowFpsTime += dt;
    else this.lowFpsTime = Math.max(0, this.lowFpsTime - dt);
    if (this.lowFpsTime > 2.5) {
      this.lowFpsTime = 0;
      const current = this.renderer.getPixelRatio();
      const next = Math.max(R.adaptiveMinPixelRatio, current - 0.25);
      if (next < current) {
        this.renderer.setPixelRatio(next);
        this.resize();
        if (next <= 1 && this.renderer.shadowMap.enabled) {
          this.renderer.shadowMap.type = THREE.BasicShadowMap;
          this.renderer.shadowMap.needsUpdate = true;
        }
      }
    }
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setCameraPose(position: THREE.Vector3, yaw: number, pitch: number): void {
    this.camera.position.copy(position);
    this.camera.rotation.set(-pitch, yaw, 0, 'YXZ');
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
