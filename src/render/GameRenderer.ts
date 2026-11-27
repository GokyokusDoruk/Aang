import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import { PostFx } from './PostFx';
import { VFX_HDR } from './ParticleField';

/** WebGL renderer, sahne, ışıklar, kamera ve responsive boyutlandırma. */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Bloom + renk düzenleme (kapalıysa / düşük performansta null: doğrudan çizim) */
  post: PostFx | null = null;

  constructor(container: HTMLElement, mobile: boolean, postFx = true) {
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
    if (postFx) this.scene.add(this.buildSky(R.skyColor));
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
    if (postFx) this.post = new PostFx(this.renderer, this.scene, this.camera, mobile);
  }

  /**
   * Gökyüzü kubbesi: ufukta sis rengi (dikişsiz), tepede derin mavi, güneş çevresinde sıcak hale.
   * Son işlemde (tonlama) düz arka plan rengi soluk kalacağı için kubbe rengi biraz doygun tutulur.
   */
  private buildSky(horizon: number): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(horizon) },
        uZenith: { value: new THREE.Color(0x3d86d6) },
        uSunDir: { value: new THREE.Vector3(18, 34, 12).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // her zaman en arkada
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          float sun = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0, 0.85, 0.6) * (pow(sun, 64.0) * 1.6 + pow(sun, 6.0) * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);
    return sky;
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
      // Önce en pahalı katman: son işlem kapanır (efekt ışımaları sade çizime döner)
      if (this.post) {
        this.post = null;
        return;
      }
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
    this.post?.resize();
  }

  setCameraPose(position: THREE.Vector3, yaw: number, pitch: number): void {
    this.camera.position.copy(position);
    this.camera.rotation.set(-pitch, yaw, 0, 'YXZ');
  }

  render(dt = 1 / 60): void {
    VFX_HDR.value = this.post ? 1 : 0;
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
