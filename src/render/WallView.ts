import * as THREE from 'three';
import type { Wall, WallSystem } from '../combat/WallSystem';

interface WallMeshes {
  group: THREE.Group;
  columns: THREE.Mesh[];
  mat: THREE.MeshStandardMaterial;
}

/** Toprak duvarlarını altıgen bazalt sütunlar olarak çizer; hasar aldıkça kararır ve sarsılır. */
export class WallView {
  private readonly views = new Map<number, WallMeshes>();
  // Altıgen sütun, tepesi hafif eğimli (yükseklik 1 → ölçeklenir)
  private readonly geo = (() => {
    const g = new THREE.CylinderGeometry(0.56, 0.6, 1, 6, 1);
    g.translate(0, 0.5, 0);
    return g;
  })();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly system: WallSystem,
  ) {}

  private create(w: Wall): WallMeshes {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b6b48, roughness: 0.95, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0 });
    const columns = w.columns.map((c, i) => {
      const m = new THREE.Mesh(this.geo, mat);
      m.position.set(c.x, c.baseY - 0.05, c.z);
      m.rotation.y = (i * 0.9) % (Math.PI / 3);
      m.scale.set(c.box.maxX - c.box.minX, 0.01, c.box.maxZ - c.box.minZ);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    });
    this.scene.add(group);
    const v = { group, columns, mat };
    this.views.set(w.id, v);
    return v;
  }

  update(): void {
    const seen = new Set<number>();
    for (const w of this.system.walls) {
      seen.add(w.id);
      const v = this.views.get(w.id) ?? this.create(w);
      const dmg = 1 - Math.max(0, w.hp) / w.maxHp;
      v.mat.color.setRGB(0.545 - 0.2 * dmg, 0.42 - 0.17 * dmg, 0.28 - 0.1 * dmg);
      v.mat.emissiveIntensity = w.hitFlash > 0 ? 0.35 : 0;
      const shake = w.hitFlash > 0 ? 0.06 : 0;
      w.columns.forEach((c, i) => {
        const m = v.columns[i];
        m.scale.y = Math.max(0.01, c.box.maxY - c.baseY + 0.05);
        m.position.x = c.x + (shake ? (Math.random() - 0.5) * shake : 0);
        m.position.z = c.z + (shake ? (Math.random() - 0.5) * shake : 0);
      });
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group);
      v.mat.dispose();
      this.views.delete(id);
    }
  }
}
