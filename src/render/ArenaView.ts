import * as THREE from 'three';
import type { ArenaLayout, BoxKind, RampDir } from '../config/arenaLayout';

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a5468';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.2)';
  g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const COLORS: Record<BoxKind, number> = {
  floor: 0xffffff,
  wall: 0x6b7590,
  cover: 0xa7825a,
  platform: 0x8590a6,
  step: 0x8590a6,
  pillar: 0x5d677d,
};

const RAMP_YAW: Record<RampDir, number> = { '-z': 0, '+z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };

/** Kama geometrisi: yerel -Z yönünde yükselir. */
function wedgeGeometry(w: number, h: number, l: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, l);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0 && pos.getZ(i) > 0) pos.setY(i, -h / 2);
  }
  geo.computeVertexNormals();
  return geo;
}

/** ArenaLayout verisinden görsel sahne grubu üretir (fizikten bağımsız). */
export function buildArenaView(layout: ArenaLayout): THREE.Group {
  const group = new THREE.Group();
  group.name = 'arena';

  const mats = new Map<BoxKind, THREE.MeshStandardMaterial>();
  const mat = (k: BoxKind) => {
    let m = mats.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: COLORS[k], roughness: 0.85, metalness: 0.05 });
      mats.set(k, m);
    }
    return m;
  };

  for (const b of layout.boxes) {
    const y = b.y ?? 0;
    let material: THREE.Material = mat(b.kind);
    if (b.kind === 'floor') {
      const tex = gridTexture();
      tex.repeat.set(b.w / 4, b.d / 4);
      material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), material);
    mesh.position.set(b.x, y + b.h / 2, b.z);
    mesh.castShadow = b.kind !== 'floor';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const rampMat = new THREE.MeshStandardMaterial({ color: 0x96a2b8, roughness: 0.8 });
  for (const r of layout.ramps) {
    const mesh = new THREE.Mesh(wedgeGeometry(r.w, r.h, r.l), rampMat);
    mesh.position.set(r.x, (r.y ?? 0) + r.h / 2, r.z);
    mesh.rotation.y = RAMP_YAW[r.dir];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Arena kenar şeridi (düşme sınırını belli etmek için)
  const half = layout.size / 2;
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffc35a });
  const t = 0.12;
  const edges: [number, number, number, number][] = [
    [0, -half, layout.size, t],
    [0, half, layout.size, t],
    [-half, 0, t, layout.size],
    [half, 0, t, layout.size],
  ];
  for (const [x, z, w, d] of edges) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), edgeMat);
    m.position.set(x, 0.03, z);
    group.add(m);
  }

  return group;
}
