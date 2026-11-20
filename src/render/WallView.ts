import * as THREE from 'three';
import type { Wall, WallSystem } from '../combat/WallSystem';
import { spikeGeometry } from './rockGeometry';

interface Spike {
  mesh: THREE.Mesh;
  col: number;
  /** Sütun yüksekliğine göre boy oranı */
  hMul: number;
  w: number;
  ox: number;
  oz: number;
}

interface WallMeshes {
  group: THREE.Group;
  spikes: Spike[];
  mat: THREE.MeshStandardMaterial;
}

const STONE = new THREE.Color(0x8e8983);
const STONE_DAMAGED = new THREE.Color(0x4d4945);

/**
 * Toprak duvarlarını yerden fırlamış sivri, kırık kaya kümeleri olarak çizer.
 * Her çarpışma sütunu = bir ana diken + çevresinde 1-2 küçük diken. Hasar aldıkça kararır ve sarsılır.
 */
export class WallView {
  private readonly views = new Map<number, WallMeshes>();
  private readonly geos = Array.from({ length: 8 }, (_, i) => spikeGeometry(i + 1));
  private seed = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: WallSystem,
    /** Yeni duvar yükselmeye başladığında (toz/enkaz efekti için) */
    private readonly onSpawn?: (points: THREE.Vector3[]) => void,
  ) {}

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed % 10000) / 10000;
  }

  private create(w: Wall): WallMeshes {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.95, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const spikes: Spike[] = [];
    const add = (col: number, hMul: number, wMul: number, ox: number, oz: number) => {
      const mesh = new THREE.Mesh(this.geos[Math.floor(this.rand() * this.geos.length)], mat);
      mesh.rotation.set((this.rand() - 0.5) * 0.25, this.rand() * Math.PI * 2, (this.rand() - 0.5) * 0.25);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      spikes.push({ mesh, col, hMul, w: wMul, ox, oz });
    };
    w.columns.forEach((c, i) => {
      const fw = Math.max(c.box.maxX - c.box.minX, c.box.maxZ - c.box.minZ);
      add(i, 1.08 + this.rand() * 0.22, fw * (1.25 + this.rand() * 0.2), 0, 0);
      const extra = 1 + (this.rand() > 0.5 ? 1 : 0);
      for (let k = 0; k < extra; k++) {
        const a = this.rand() * Math.PI * 2;
        const d = fw * (0.35 + this.rand() * 0.2);
        add(i, 0.45 + this.rand() * 0.3, fw * (0.6 + this.rand() * 0.25), Math.cos(a) * d, Math.sin(a) * d);
      }
    });
    this.scene.add(group);
    const v = { group, spikes, mat };
    this.views.set(w.id, v);
    this.onSpawn?.(w.columns.map((c) => new THREE.Vector3(c.x, c.baseY, c.z)));
    return v;
  }

  update(): void {
    const seen = new Set<number>();
    for (const w of this.system.walls) {
      seen.add(w.id);
      const v = this.views.get(w.id) ?? this.create(w);
      const dmg = 1 - Math.max(0, w.hp) / w.maxHp;
      v.mat.color.copy(STONE).lerp(STONE_DAMAGED, dmg);
      v.mat.emissiveIntensity = w.hitFlash > 0 ? 0.3 : 0;
      const shake = w.hitFlash > 0 ? 0.06 : w.state === 'rising' ? 0.03 : 0;
      for (const s of v.spikes) {
        const c = w.columns[s.col];
        const h = Math.max(0.01, c.box.maxY - c.baseY + 0.05);
        s.mesh.scale.set(s.w, h * s.hMul, s.w);
        s.mesh.position.set(
          c.x + s.ox + (shake ? (Math.random() - 0.5) * shake : 0),
          c.baseY - 0.08,
          c.z + s.oz + (shake ? (Math.random() - 0.5) * shake : 0),
        );
      }
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      v.mat.dispose();
      this.views.delete(id);
    }
  }
}
