import * as THREE from 'three';

/**
 * GPU'da çizilen, CPU'da güncellenen hafif parçacık alanı (THREE.Points + özel shader).
 * Her parçacık ömrü boyunca boyut, renk ve saydamlık değiştirir; sürtünme, yerçekimi ve türbülans uygular.
 * Ateş için toplamalı (additive), duman / toz için normal karışım kullanılır.
 */
export interface EmitOptions {
  life: number;
  size0: number;
  size1: number;
  color0: THREE.Color;
  color1: THREE.Color;
  alpha?: number;
  drag?: number;
  /** + yukarı ivme (ateş yükselir), - aşağı (toz düşer) */
  lift?: number;
  /** Rastgele sallanma şiddeti (m/s²) */
  turbulence?: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aRot;
varying float vAlpha;
varying vec3 vColor;
varying float vRot;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  vec4 t = texture2D(uMap, p);
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

export class ParticleField {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly a0: Float32Array;
  private readonly drag: Float32Array;
  private readonly lift: Float32Array;
  private readonly turb: Float32Array;
  private next = 0;
  private alive = 0;

  constructor(
    scene: THREE.Scene,
    private readonly max: number,
    map: THREE.Texture,
    additive: boolean,
  ) {
    const n = max;
    this.pos = new Float32Array(n * 3).fill(-1e4);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.size = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.a0 = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.lift = new Float32Array(n);
    this.turb = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points);
  }

  /** Ekran yüksekliğine göre nokta ölçeği (piksel / birim) */
  setViewportHeight(px: number, fovDeg: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: EmitOptions): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.s0[i] = o.size0;
    this.s1[i] = o.size1;
    this.c0[i3] = o.color0.r;
    this.c0[i3 + 1] = o.color0.g;
    this.c0[i3 + 2] = o.color0.b;
    this.c1[i3] = o.color1.r;
    this.c1[i3 + 1] = o.color1.g;
    this.c1[i3 + 2] = o.color1.b;
    this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 1;
    this.lift[i] = o.lift ?? 0;
    this.turb[i] = o.turbulence ?? 0;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 3;
    this.alive = Math.min(this.max, this.alive + 1);
  }

  update(dt: number): void {
    const t = performance.now() * 0.001;
    for (let i = 0; i < this.max; i++) {
      const life = this.life[i];
      if (life <= 0) continue;
      const i3 = i * 3;
      const a = (this.age[i] += dt);
      if (a >= life) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.pos[i3 + 1] = -1e4;
        continue;
      }
      const k = a / life;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const tb = this.turb[i];
      this.vel[i3] = this.vel[i3] * d + (tb ? Math.sin(t * 7 + i * 1.3) * tb * dt : 0);
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.lift[i] * dt;
      this.vel[i3 + 2] = this.vel[i3 + 2] * d + (tb ? Math.cos(t * 6.3 + i * 0.7) * tb * dt : 0);
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      // Renk: ömrün ilk yarısında hızlı geçiş (ateş sarıdan kırmızıya)
      const ck = Math.min(1, k * 1.6);
      this.col[i3] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * ck;
      this.col[i3 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * ck;
      this.col[i3 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * ck;
      // Hızlı belir, yavaş sön
      this.alpha[i] = this.a0[i] * Math.min(1, k * 8) * (1 - k) * (1 - k * 0.3);
      this.rot[i] += this.spin[i] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aRot as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Yumuşak kenarlı, ortası parlak alev / kıvılcım dokusu */
export function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Pürüzlü kenarlı, bulut gibi duman / toz dokusu (rastgele lekeler) */
export function puffTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) % 1000) / 1000;
  for (let i = 0; i < 14; i++) {
    const x = 32 + (rnd() - 0.5) * 26;
    const y = 32 + (rnd() - 0.5) * 26;
    const r = 10 + rnd() * 14;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}
