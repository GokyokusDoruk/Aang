import * as THREE from 'three';

/** 3B değer gürültüsü + fbm (shader içi, doku gerekmez) */
const NOISE = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return v; }
`;

/**
 * Rüzgar küresi: kenarda yumuşak parlama (fresnel), içinde sürekli dönen bulanık fırtına bulutları.
 * Keskin çizgi yok; tamamen gürültü tabanlı, saydam.
 */
export function windBallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uSpeed: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vObj; varying vec3 vN; varying vec3 vV;
      void main() {
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime; uniform float uOpacity; uniform float uSpeed;
      varying vec3 vObj; varying vec3 vN; varying vec3 vV;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        // Girdap: yüksekliğe ve merkeze uzaklığa göre dönen koordinatlar
        float r = length(vObj.xz);
        float ang = uTime * 2.6 * uSpeed + r * 2.5 + vObj.y * 1.5;
        float c = cos(ang), s = sin(ang);
        vec3 p = vec3(c * vObj.x - s * vObj.z, vObj.y, s * vObj.x + c * vObj.z);
        float n1 = fbm(p * 2.2 + vec3(0.0, uTime * 0.8, 0.0));
        float n2 = fbm(p * 4.5 - vec3(uTime * 0.5, 0.0, uTime * 0.7));
        float wisps = smoothstep(0.42, 0.78, n1) * 0.75 + smoothstep(0.5, 0.85, n2) * 0.35;
        float a = (fres * 0.5 + wisps * 0.55) * uOpacity;
        vec3 col = mix(vec3(0.72, 0.86, 1.0), vec3(1.0), clamp(wisps, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Hortum hunisi: yukarı genişleyen, yılan gibi kıvrılan, sarmal akan toz-hava katmanı.
 * dusty: dış katman (tozlu, kahve-gri), değilse iç katman (açık, havalı).
 */
export function funnelMaterial(dusty: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uHeight: { value: 4 } },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uHeight;
      varying vec3 vObj; varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 p = position;
        float h = clamp(p.y / uHeight, 0.0, 1.0);
        vH = h;
        // Gövde kıvrılır: yükseldikçe salınım artar
        p.x += sin(p.y * 1.3 - uTime * 2.2) * 0.35 * h;
        p.z += cos(p.y * 1.1 - uTime * 1.8) * 0.3 * h;
        vObj = position;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uTime; uniform float uOpacity;
      varying vec3 vObj; varying float vH; varying vec3 vN; varying vec3 vV;
      void main() {
        float ang = atan(vObj.z, vObj.x);
        // Sarmal akış: açı zamanla döner, yukarı doğru kayar
        float u = ang + uTime * ${dusty ? '5.0' : '7.0'} - vObj.y * 0.9;
        vec3 q = vec3(cos(u) * 1.6, vObj.y * 0.9 - uTime * ${dusty ? '2.4' : '3.2'}, sin(u) * 1.6);
        float n = fbm(q * ${dusty ? '1.6' : '2.4'});
        float band = smoothstep(${dusty ? '0.38' : '0.45'}, 0.8, n);
        float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        // Altta ve üstte yumuşak söner
        float edge = smoothstep(0.0, 0.12, vH) * (1.0 - smoothstep(0.82, 1.0, vH));
        float a = band * edge * (0.45 + 0.55 * fres) * uOpacity * ${dusty ? '0.85' : '0.55'};
        vec3 col = ${dusty ? 'mix(vec3(0.42, 0.37, 0.31), vec3(0.78, 0.74, 0.68), n)' : 'mix(vec3(0.75, 0.82, 0.9), vec3(1.0), n)'};
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Hunı geometrisi: altta dar, üstte geniş, açık uçlu (y: 0 → h) */
export function funnelGeometry(r0: number, r1: number, h: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, 1.7), t * h));
  }
  return new THREE.LatheGeometry(pts, 40);
}
