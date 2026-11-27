import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Son işlem (post-processing): HDR bloom + sinematik renk düzenleme.
 * Görsel; oyun kurallarını etkilemez. GameFeel her karede `state` alanlarını sürer.
 *
 * Zincir: sahne (HDR, MSAA) → bloom → tonlama + sRGB (OutputPass) → renk / lens geçişi (ekrana).
 */
export interface PostFxState {
  /** Kromatik sapma şiddeti (vuruş / sarsıntı) 0..1 */
  aberration: number;
  /** Ekran merkezinden radyal hız bulanıklığı (dash) 0..1 */
  radial: number;
  /** Ağır çekim final vuruşu: renk solar + sıcak ton 0..1 */
  slowmo: number;
  /** Düşük can: kenarlar kızarır, renk solar, nabız atar 0..1 */
  lowHp: number;
  /** Hasar alındığında kısa kırmızı kenar parlaması 0..1 */
  hurt: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uAberration: { value: 0 },
    uRadial: { value: 0 },
    uSlowmo: { value: 0 },
    uLowHp: { value: 0 },
    uHurt: { value: 0 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform float uRadial;
    uniform float uSlowmo;
    uniform float uLowHp;
    uniform float uHurt;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(uAspect, 1.0));

      // Kromatik sapma: kenarlara doğru artar (merkez nişan noktası net kalır)
      float ab = (0.0012 + uAberration * 0.012) * smoothstep(0.1, 0.9, r);
      vec2 off = c * ab;

      vec3 col;
      if (uRadial > 0.01) {
        // Dash: merkezden dışa hız bulanıklığı (8 örnek)
        vec3 acc = vec3(0.0);
        float strength = uRadial * 0.07 * smoothstep(0.15, 0.75, r);
        for (int i = 0; i < 8; i++) {
          float k = 1.0 - strength * float(i) / 7.0;
          vec2 uv = 0.5 + c * k;
          acc.r += texture2D(tDiffuse, uv + off).r;
          acc.g += texture2D(tDiffuse, uv).g;
          acc.b += texture2D(tDiffuse, uv - off).b;
        }
        col = acc / 8.0;
      } else {
        col.r = texture2D(tDiffuse, vUv + off).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - off).b;
      }

      // Hafif kontrast + doygunluk (canlı, "çizgi film" arena)
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float desat = uSlowmo * 0.55 + uLowHp * 0.35;
      col = mix(vec3(luma), col, 1.12 - desat);
      col = (col - 0.5) * (1.06 + uSlowmo * 0.12) + 0.5;
      // Gölgeler hafif serin, ışıklar hafif sıcak (split-tone)
      col += vec3(-0.012, 0.0, 0.018) * (1.0 - luma) + vec3(0.02, 0.008, -0.012) * luma;
      // Final vuruşu: sıcak, sinematik ton
      col = mix(col, col * vec3(1.12, 0.96, 0.78), uSlowmo * 0.7);

      // Vinyet (+ düşük canda kırmızı nabız, hasarda kırmızı parlama)
      float vig = smoothstep(0.35, 1.05, r);
      col *= 1.0 - vig * (0.32 + uSlowmo * 0.35);
      float beat = 0.6 + 0.4 * pow(abs(sin(uTime * 3.6)), 6.0);
      float red = clamp(uLowHp * beat * 0.75 + uHurt * 0.9, 0.0, 1.0);
      col = mix(col, vec3(0.65, 0.02, 0.02), vig * red * 0.85);

      // İnce film grenı (renk bantlaşmasını kırar)
      col += (hash(vUv * 1000.0 + fract(uTime)) - 0.5) * 0.018;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFx {
  readonly state: PostFxState = { aberration: 0, radial: 0, slowmo: 0, lowHp: 0, hurt: 0 };
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly baseStrength: number;
  private time = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    mobile: boolean,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    // HDR ara hedef: bloom parlak (>1) element efektlerini yakalar. Masaüstünde MSAA korunur.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: mobile ? 0 : 4,
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.baseStrength = mobile ? 0.5 : 0.62;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.baseStrength, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.resize();
  }

  resize(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.grade.uniforms.uAspect.value = size.x / Math.max(1, size.y);
  }

  render(dt: number): void {
    this.time += dt;
    const u = this.grade.uniforms;
    const s = this.state;
    u.uTime.value = this.time;
    u.uAberration.value = s.aberration;
    u.uRadial.value = s.radial;
    u.uSlowmo.value = s.slowmo;
    u.uLowHp.value = s.lowHp;
    u.uHurt.value = s.hurt;
    // Ağır çekimde bloom güçlenir: efektler "parlar"
    this.bloom.strength = this.baseStrength + s.slowmo * 0.35;
    this.composer.render(dt);
  }
}
