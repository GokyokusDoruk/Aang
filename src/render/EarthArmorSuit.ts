import * as THREE from 'three';
import { boulderGeometry } from './rockGeometry';

/**
 * Toprak Zırhı görseli: karakterin tüm vücudu küçük kaya / toprak parçalarıyla kaplanır (demir adam zırhı gibi, toprak renginde).
 * - Kostüm: gövde ağının iskelete bağlı, hafif şişirilmiş kopyası. Bağlama pozundaki konuma göre 3B hücre (Voronoi) deseni:
 *   her hücre ayrı bir taş pulu (kendi rengi, kendi eğimi, kenarlarında koyu çatlak). Pullar animasyonla birlikte hareket eder.
 * - Kabartma: kemiklere takılı küçük alçak poligonlu kaya parçaları siluete pürüz verir.
 * Zırh azaldıkça pullar ve parçalar rastgele dökülür.
 */

const NOISE = /* glsl */ `
vec3 armorHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// x: en yakın hücre uzaklığı, y: ikinci en yakın, z: hücre kimliği (0..1)
vec3 armorCell(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int k = -1; k <= 1; k++) {
    vec3 g = vec3(float(k), float(y), float(z));
    vec3 o = armorHash3(i + g);
    vec3 r = g + o * 0.85 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = fract(o.x * 7.13 + o.y * 3.71 + o.z * 1.37); }
    else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
`;

export interface ArmorUniforms {
  uCover: { value: number };
  uHeavy: { value: number };
  uInflate: { value: number };
  uFreq: { value: number };
}

function suitMaterial(u: ArmorUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uInflate;
uniform float uFreq;
varying vec3 vArmorRest;
${NOISE}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vArmorRest = position * uFreq;
vec3 armorC = armorCell(vArmorRest);
// Pulun ortası kabarık, kenarı içeride: yüzey taş taş pürüzlü
float armorBulge = 0.55 + 0.45 * armorC.z + 0.35 * clamp(armorC.y - armorC.x, 0.0, 1.0);
transformed += normalize(normal) * uInflate * armorBulge;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCover;
uniform float uHeavy;
varying vec3 vArmorRest;
${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 armorC = armorCell(vArmorRest);
// Dökülen pullar: kimliği kapsama oranının üstündeki hücreler görünmez
if (armorC.z > uCover) discard;
float edge = armorC.y - armorC.x;
float crack = smoothstep(0.02, 0.16, edge);
vec3 h = armorHash3(vec3(armorC.z * 91.7, armorC.z * 17.3, armorC.z * 53.1));
// Toprak tonları: kahve, koyu toprak, kumlu taş, kırmızımsı kil
vec3 earthA = vec3(0.46, 0.33, 0.21);
vec3 earthB = vec3(0.33, 0.24, 0.16);
vec3 earthC = vec3(0.56, 0.45, 0.32);
vec3 earthD = vec3(0.50, 0.30, 0.19);
vec3 rock = mix(mix(earthA, earthB, h.x), mix(earthC, earthD, h.y), h.z);
// Ağır zırh daha koyu, daha taşlı
rock = mix(rock, rock * vec3(0.72, 0.74, 0.78), uHeavy);
// Pul üzerinde ince taneli toprak dokusu
float grain = fract(sin(dot(floor(vArmorRest * 9.0), vec3(12.99, 78.23, 37.71))) * 43758.55);
rock *= 0.9 + 0.2 * grain;
// Çatlaklar koyu, pul ortası hafif açık
rock = mix(vec3(0.10, 0.07, 0.05), rock, crack);
diffuseColor.rgb = rock;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
// Her pul hafif farklı eğimde: ışığı ayrı ayrı yakalar (yontulmuş taş görünümü)
normal = normalize(normal + (h - 0.5) * 0.7);`,
      );
  };
  // Aynı shader'ı paylaşan tüm zırhlar için tek program
  mat.customProgramCacheKey = () => 'earthArmorSuit';
  return mat;
}

/** Kaya parçası takılacak kemikler: [kemik, uç kemik (yön), uzuv yarıçapı (m), parça sayısı] */
const CHUNK_BONES: [string, string | null, number, number][] = [
  ['pelvis', 'spine_01', 0.16, 6],
  ['spine_01', 'spine_02', 0.16, 5],
  ['spine_02', 'spine_03', 0.17, 6],
  ['spine_03', 'neck_01', 0.17, 8],
  ['neck_01', 'Head', 0.07, 3],
  ['Head', null, 0.11, 6],
  ['clavicle_l', 'upperarm_l', 0.07, 2],
  ['clavicle_r', 'upperarm_r', 0.07, 2],
  ['upperarm_l', 'lowerarm_l', 0.065, 5],
  ['upperarm_r', 'lowerarm_r', 0.065, 5],
  ['lowerarm_l', 'hand_l', 0.055, 4],
  ['lowerarm_r', 'hand_r', 0.055, 4],
  ['hand_l', 'middle_01_l', 0.045, 2],
  ['hand_r', 'middle_01_r', 0.045, 2],
  ['thigh_l', 'calf_l', 0.09, 6],
  ['thigh_r', 'calf_r', 0.09, 6],
  ['calf_l', 'foot_l', 0.07, 5],
  ['calf_r', 'foot_r', 0.07, 5],
  ['foot_l', 'ball_l', 0.055, 2],
  ['foot_r', 'ball_r', 0.055, 2],
];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

export class EarthArmorSuit {
  readonly ok: boolean;
  private readonly uniforms: ArmorUniforms = {
    uCover: { value: 1 },
    uHeavy: { value: 0 },
    uInflate: { value: 0.03 },
    uFreq: { value: 14 },
  };
  private readonly suits: THREE.SkinnedMesh[] = [];
  private readonly chunks: { mesh: THREE.Mesh; id: number; base: number }[] = [];
  private readonly chunkMat = new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 1, flatShading: true });
  private readonly chunkGeos = [31, 32, 33, 34, 35].map((s) => boulderGeometry(s));
  private visible = false;
  /** Giyilirken / dökülürken yumuşak kapsama */
  private cover = 0;

  constructor(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const mat = suitMaterial(this.uniforms);
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      // Gövde ağı (kıyafet bölgelerine ayrılmış olan); göz / kaş ağları atlanır
      if (!m.isSkinnedMesh || m.geometry.groups.length !== 5) return;
      const suit = new THREE.SkinnedMesh(m.geometry, mat);
      suit.bind(m.skeleton, m.bindMatrix);
      suit.position.copy(m.position);
      suit.quaternion.copy(m.quaternion);
      suit.scale.copy(m.scale);
      suit.castShadow = true;
      suit.frustumCulled = false;
      suit.visible = false;
      m.parent!.add(suit);
      this.suits.push(suit);
      // Model birimini metreye çevir: şişirme ~3 cm, taş pulu ~7 cm
      const unit = m.getWorldScale(new THREE.Vector3()).x / Math.max(1e-6, root.parent ? root.parent.getWorldScale(new THREE.Vector3()).x : 1);
      this.uniforms.uInflate.value = 0.028 / unit;
      this.uniforms.uFreq.value = unit / 0.07;
    });
    this.buildChunks(root);
    this.ok = this.suits.length > 0;
  }

  /** Kemiklere, uzvun etrafına dağılmış küçük kaya parçaları */
  private buildChunks(root: THREE.Object3D): void {
    const r = rng(4242);
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    const wa = new THREE.Vector3();
    const wb = new THREE.Vector3();
    const seg = new THREE.Vector3();
    const perpA = new THREE.Vector3();
    const perpB = new THREE.Vector3();
    let id = 0;
    for (const [name, tipName, radius, count] of CHUNK_BONES) {
      const bone = root.getObjectByName(name);
      if (!bone) continue;
      const tip = tipName ? root.getObjectByName(tipName) : null;
      // Kemiğe, modelin kök eksenleriyle hizalı metre ölçekli grup
      const g = new THREE.Group();
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      const bs = bone.getWorldScale(new THREE.Vector3()).x || 1;
      g.quaternion.copy(bq.invert().multiply(rootQ));
      g.scale.setScalar(1 / bs);
      bone.add(g);
      g.updateMatrixWorld(true);
      bone.getWorldPosition(wa);
      if (tip) tip.getWorldPosition(wb);
      else wb.copy(wa).y += 0.2; // baş: yukarı doğru
      const la = g.worldToLocal(wa.clone());
      const lb = g.worldToLocal(wb.clone());
      seg.subVectors(lb, la);
      const len = seg.length() || 0.1;
      seg.divideScalar(len);
      perpA.set(seg.y, -seg.x, 0);
      if (perpA.lengthSq() < 1e-4) perpA.set(0, seg.z, -seg.y);
      perpA.normalize();
      perpB.crossVectors(seg, perpA).normalize();
      const torso = /pelvis|spine/.test(name);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.2 + r() * 0.6) / count;
        const a = r() * Math.PI * 2;
        const m = new THREE.Mesh(this.chunkGeos[id % this.chunkGeos.length], this.chunkMat);
        const p = la.clone().addScaledVector(seg, len * t);
        const off = perpA.clone().multiplyScalar(Math.cos(a)).addScaledVector(perpB, Math.sin(a));
        // Gövde yanlara geniş, önden arkaya dar
        if (torso) {
          off.x *= 1.25;
          off.z *= 0.85;
        }
        p.addScaledVector(off, radius * 0.92);
        m.position.copy(p);
        const base = (0.03 + r() * 0.03) * (torso ? 1.3 : 1);
        m.scale.setScalar(base);
        m.rotation.set(r() * 6, r() * 6, r() * 6);
        m.castShadow = true;
        m.visible = false;
        g.add(m);
        this.chunks.push({ mesh: m, id: r(), base });
        id++;
      }
    }
  }

  /** frac: kalan zırh oranı (0 = yok), heavy: ağır zırh */
  update(frac: number, heavy: boolean, dt: number): void {
    const target = frac > 0 ? 0.25 + 0.75 * frac : 0;
    // Giyerken hızlı kaplar, dökülürken biraz daha yavaş
    const rate = target > this.cover ? 5 : 3;
    this.cover += Math.sign(target - this.cover) * Math.min(Math.abs(target - this.cover), rate * dt);
    const on = this.cover > 0.01;
    if (on !== this.visible) {
      this.visible = on;
      for (const s of this.suits) s.visible = on;
    }
    if (!on) {
      for (const c of this.chunks) c.mesh.visible = false;
      return;
    }
    this.uniforms.uCover.value = this.cover;
    this.uniforms.uHeavy.value = heavy ? 1 : 0;
    this.chunkMat.color.setHex(heavy ? 0x5a4430 : 0x6e5236);
    const k = heavy ? 1.35 : 1;
    for (const c of this.chunks) {
      c.mesh.visible = c.id < this.cover;
      if (c.mesh.visible) c.mesh.scale.setScalar(c.base * k * (0.6 + 0.4 * Math.min(1, this.cover * 1.5)));
    }
  }

  dispose(): void {
    for (const s of this.suits) {
      s.removeFromParent();
      (s.material as THREE.Material).dispose();
    }
    for (const c of this.chunks) c.mesh.removeFromParent();
    this.chunkMat.dispose();
  }
}
