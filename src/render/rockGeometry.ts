import * as THREE from 'three';

/** Tekrarlanabilir küçük rastgele sayı üreteci (aynı tohum → aynı kaya). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/**
 * Sivri, kırık kaya dikeni: tabanı 0'da, tepesi 1'de (y ekseni), taban yarıçapı ~0.5.
 * Köşeleri rastgele itilmiş düşük poligonlu koni; flatShading ile kırık taş görünümü verir.
 */
export function spikeGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed * 7919 + 13);
  const sides = 5 + Math.floor(r() * 3);
  const rings = 4;
  const lean = (r() - 0.5) * 0.25;
  const pos: number[] = [];
  const ringPts: THREE.Vector3[][] = [];
  for (let i = 0; i < rings; i++) {
    const t = i / rings;
    const rad = 0.5 * Math.pow(1 - t, 0.85) * (0.85 + r() * 0.3);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const rr = rad * (0.7 + r() * 0.5);
      pts.push(new THREE.Vector3(Math.cos(a) * rr + lean * t, t + (r() - 0.5) * 0.06, Math.sin(a) * rr));
    }
    ringPts.push(pts);
  }
  const tip = new THREE.Vector3(lean + (r() - 0.5) * 0.08, 1, (r() - 0.5) * 0.08);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < rings; i++) {
    const lo = ringPts[i];
    const hi = i + 1 < rings ? ringPts[i + 1] : null;
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      if (hi) {
        tri(lo[k], hi[k], lo[k2]);
        tri(lo[k2], hi[k], hi[k2]);
      } else {
        tri(lo[k], tip, lo[k2]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Yuvarlak olmayan, köşeli kaya parçası (yarıçap ~1). */
export function boulderGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed * 104729 + 7);
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  // Aynı konumdaki köşeleri aynı miktarda it (yüzeyde çatlak oluşmasın)
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) {
      k = 0.72 + r() * 0.5;
      cache.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k * 1.1, p.getY(i) * k * 0.85, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
