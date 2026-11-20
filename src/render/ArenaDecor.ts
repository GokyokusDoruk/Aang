import * as THREE from 'three';
import type { ArenaLayout, BoxDef } from '../config/arenaLayout';
import { ELEMENTS, ELEMENT_ORDER, type ElementId } from '../abilities/elements';

/**
 * Arena süsleri (yalnızca görsel, çarpışma yok):
 * - Oyun alanının çevresinde boşluk (düşme çukuru) ve onun ötesinde stadyum duvarı + tribünler + seyirciler
 * - Duvarlarda ve sütunlarda element renklerinde asılı bayraklar (özgün sembollerle)
 * - Zeminde renkli bölgeler (doğuş noktaları, yan platform alanları, merkez halkası)
 */

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Element sembolü: özgün, basit geometrik işaretler. */
function drawEmblem(g: CanvasRenderingContext2D, el: ElementId, cx: number, cy: number, r: number): void {
  g.strokeStyle = g.fillStyle = 'rgba(255,248,230,0.92)';
  g.lineWidth = r * 0.16;
  g.lineCap = 'round';
  g.beginPath();
  if (el === 'earth') {
    // Üç tepe
    g.moveTo(cx - r, cy + r * 0.6);
    g.lineTo(cx - r * 0.45, cy - r * 0.3);
    g.lineTo(cx - r * 0.1, cy + r * 0.2);
    g.lineTo(cx + r * 0.35, cy - r * 0.7);
    g.lineTo(cx + r, cy + r * 0.6);
    g.closePath();
    g.fill();
  } else if (el === 'water') {
    // Üst üste iki dalga
    for (const dy of [-0.3, 0.3]) {
      g.moveTo(cx - r, cy + r * dy);
      g.bezierCurveTo(cx - r * 0.5, cy + r * (dy - 0.45), cx, cy + r * (dy + 0.45), cx + r * 0.5, cy + r * dy);
      g.quadraticCurveTo(cx + r * 0.75, cy + r * (dy - 0.25), cx + r, cy + r * dy);
    }
    g.stroke();
  } else if (el === 'fire') {
    // Damla biçimli alev
    g.moveTo(cx, cy - r);
    g.bezierCurveTo(cx + r * 0.9, cy - r * 0.1, cx + r * 0.8, cy + r * 0.9, cx, cy + r * 0.9);
    g.bezierCurveTo(cx - r * 0.8, cy + r * 0.9, cx - r * 0.9, cy - r * 0.1, cx, cy - r);
    g.fill();
  } else {
    // Sarmal (hava)
    for (let a = 0; a < Math.PI * 3.2; a += 0.15) {
      const rr = r * (0.1 + a / (Math.PI * 3.6));
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (a === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

function bannerTexture(el: ElementId): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 160;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(ELEMENTS[el].color);
  const dark = col.clone().multiplyScalar(0.55);
  g.fillStyle = hex(col.getHex());
  g.fillRect(0, 0, 64, 160);
  // Kenar şeridi ve uç üçgenler
  g.fillStyle = hex(dark.getHex());
  g.fillRect(0, 0, 64, 10);
  g.fillRect(0, 0, 5, 160);
  g.fillRect(59, 0, 5, 160);
  g.fillStyle = '#e8c45a';
  g.fillRect(0, 10, 64, 3);
  drawEmblem(g, el, 32, 66, 20);
  // Alt uç: kırlangıç kuyruğu (saydam kesik)
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(0, 160);
  g.lineTo(32, 136);
  g.lineTo(64, 160);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hafif dalgalanan bayrak (köşe noktaları her karede kaydırılır). */
class Banner {
  readonly mesh: THREE.Mesh;
  private readonly base: Float32Array;
  private readonly phase = Math.random() * 10;

  constructor(mat: THREE.Material, w: number, h: number) {
    const geo = new THREE.PlaneGeometry(w, h, 1, 6);
    geo.translate(0, -h / 2, 0);
    this.base = (geo.getAttribute('position').array as Float32Array).slice();
    this.mesh = new THREE.Mesh(geo, mat);
  }

  update(t: number): void {
    const p = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const h = -this.base[p.count * 3 - 2] || 1;
    for (let i = 0; i < p.count; i++) {
      const y = this.base[i * 3 + 1];
      const k = -y / h; // 0 tepe, 1 uç
      // Yalnızca duvardan dışarı doğru dalgalanır (duvarın içine girmez)
      p.setZ(i, 0.04 + (Math.sin(t * 2.2 + this.phase + k * 3) + 1) * 0.08 * k);
    }
    p.needsUpdate = true;
  }
}

export class ArenaDecor {
  readonly group = new THREE.Group();
  private readonly banners: Banner[] = [];
  private time = 0;

  constructor(layout: ArenaLayout, mobile: boolean) {
    this.group.name = 'arena-decor';
    const half = layout.size / 2;
    const bannerMats = ELEMENT_ORDER.map(
      (el) => new THREE.MeshStandardMaterial({ map: bannerTexture(el), side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, roughness: 0.9 }),
    );
    let bi = 0;
    const addBanner = (x: number, y: number, z: number, yaw: number, w = 1.6, h = 4) => {
      const b = new Banner(bannerMats[bi++ % bannerMats.length], w, h);
      b.mesh.position.set(x, y, z);
      b.mesh.rotation.y = yaw;
      this.group.add(b.mesh);
      this.banners.push(b);
    };

    this.buildZones(layout);
    this.buildStadium(half, addBanner, mobile);

    // Sütunların merkeze bakan iki yüzünde bayrak
    for (const b of layout.boxes.filter((b: BoxDef) => b.kind === 'pillar')) {
      const top = (b.y ?? 0) + b.h - 0.3;
      const sx = -Math.sign(b.x);
      const sz = -Math.sign(b.z);
      addBanner(b.x + sx * (b.w / 2 + 0.02), top, b.z, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 1.2, 3.2);
      addBanner(b.x, top, b.z + sz * (b.d / 2 + 0.02), sz > 0 ? 0 : Math.PI, 1.2, 3.2);
      // Sütun başlığı (altın kenarlı)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, 0.35, b.d + 0.4), GOLD);
      cap.position.set(b.x, (b.y ?? 0) + b.h + 0.17, b.z);
      cap.castShadow = true;
      this.group.add(cap);
    }
  }

  /** Zeminde renkli alanlar: zemin üstünde ince, gölge alan düz yüzeyler. */
  private buildZones(layout: ArenaLayout): void {
    const zoneMat = (color: number, opacity = 1) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: -1 });
    const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, y = 0.012) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    const orange = zoneMat(0xe8892f);
    const blue = zoneMat(0x3d7fd6, 0.85);
    const red = zoneMat(0xd2483c, 0.85);
    const stripe = zoneMat(0xf3d27a);

    // Yan platform alanları: geniş turuncu şerit (videodaki turuncu zemin bölgeleri gibi)
    for (const sx of [-1, 1]) {
      flat(new THREE.PlaneGeometry(9, 15), orange, sx * 16.5, 0);
      flat(new THREE.PlaneGeometry(0.25, 15), stripe, sx * 12, 0, 0.016);
    }
    // Merkez halkası
    flat(new THREE.RingGeometry(7.2, 7.7, 48), stripe, 0, 0);
    // Doğuş noktaları: oyuncu mavi, rakip kırmızı daire + halka
    layout.spawnPoints.forEach((s, i) => {
      flat(new THREE.CircleGeometry(2.6, 32), i === 0 ? blue : red, s.x, s.z, s.y + 0.014);
      flat(new THREE.RingGeometry(2.6, 2.9, 32), stripe, s.x, s.z, s.y + 0.016);
    });
  }

  /** Düşme çukuru + çevre duvarı + kademeli tribünler + seyirciler + duvar bayrakları. */
  private buildStadium(
    half: number,
    addBanner: (x: number, y: number, z: number, yaw: number, w?: number, h?: number) => void,
    mobile: boolean,
  ): void {
    const PIT = -16;
    const gap = 7; // arena kenarı ile stadyum duvarı arası
    const inner = half + gap;
    const wallTop = 6;
    const span = inner * 2;

    // Çukur zemini (aşağıda koyu, sisle kaybolur)
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(span + 4, span + 4), new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 1 }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = PIT;
    this.group.add(pit);

    // Arena zemin bloğunun yan yüzleri (havada asılı görünmesin diye kalın taban)
    const base = new THREE.Mesh(new THREE.BoxGeometry(half * 2, -PIT - 1.2, half * 2), new THREE.MeshStandardMaterial({ color: 0x5c5468, roughness: 0.95 }));
    base.position.y = -1 + PIT / 2 + 0.4;
    this.group.add(base);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7f96, roughness: 0.9 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x3f8f72, roughness: 0.85 });
    const tierMat = new THREE.MeshStandardMaterial({ color: 0x9d93a8, roughness: 0.9 });
    const sides: { nx: number; nz: number }[] = [
      { nx: 0, nz: -1 },
      { nx: 0, nz: 1 },
      { nx: -1, nz: 0 },
      { nx: 1, nz: 0 },
    ];
    const crowdPerRow = mobile ? 26 : 44;
    const tiers = 4;
    const crowd = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.55, 0.9, 0.45),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      sides.length * tiers * crowdPerRow,
    );
    const palette = [0xd2483c, 0x3d7fd6, 0xe8c45a, 0x5aa86a, 0xe8892f, 0x9b5cff, 0xeeeeee, 0x30343f];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let ci = 0;

    for (const s of sides) {
      const alongX = s.nz !== 0;
      const yaw = Math.atan2(-s.nx, -s.nz); // iç yüz merkeze bakar
      const len = span + 2;
      // Ana duvar
      const wall = new THREE.Mesh(
        alongX ? new THREE.BoxGeometry(len, wallTop - PIT, 1) : new THREE.BoxGeometry(1, wallTop - PIT, len),
        wallMat,
      );
      wall.position.set(s.nx * (inner + 0.5), (wallTop + PIT) / 2, s.nz * (inner + 0.5));
      this.group.add(wall);
      // Yeşil alt bant (oyun alanı hizasında) ve altın kenar
      const band = new THREE.Mesh(alongX ? new THREE.BoxGeometry(len, 1.6, 0.2) : new THREE.BoxGeometry(0.2, 1.6, len), bandMat);
      band.position.set(s.nx * inner, 0.4, s.nz * inner);
      this.group.add(band);
      const trim = new THREE.Mesh(alongX ? new THREE.BoxGeometry(len, 0.3, 1.3) : new THREE.BoxGeometry(1.3, 0.3, len), GOLD);
      trim.position.set(s.nx * (inner + 0.5), wallTop + 0.15, s.nz * (inner + 0.5));
      this.group.add(trim);

      // Duvar bayrakları
      for (let k = -3; k <= 3; k++) {
        const t = k * (span / 8);
        const x = alongX ? t : s.nx * (inner - 0.05);
        const z = alongX ? s.nz * (inner - 0.05) : t;
        addBanner(x, wallTop - 0.4, z, yaw, 1.8, 4.6);
      }

      // Kademeli tribünler + seyirciler
      for (let r = 0; r < tiers; r++) {
        const depth = 1.6;
        const off = inner + 1 + r * depth + depth / 2;
        const y = wallTop + r * 0.9;
        const tier = new THREE.Mesh(
          alongX ? new THREE.BoxGeometry(len + r * 2 * depth, 0.9, depth) : new THREE.BoxGeometry(depth, 0.9, len + r * 2 * depth),
          tierMat,
        );
        tier.position.set(s.nx * off, y + 0.45, s.nz * off);
        this.group.add(tier);
        for (let k = 0; k < crowdPerRow; k++) {
          const t = (k / (crowdPerRow - 1) - 0.5) * (len - 2) + (Math.random() - 0.5) * 0.4;
          const x = alongX ? t : s.nx * off;
          const z = alongX ? s.nz * off : t;
          const sc = 0.85 + Math.random() * 0.3;
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw + (Math.random() - 0.5) * 0.4);
          m4.compose(new THREE.Vector3(x, y + 0.9 + 0.45 * sc, z), q, new THREE.Vector3(sc, sc, sc));
          crowd.setMatrixAt(ci, m4);
          crowd.setColorAt(ci, col.setHex(palette[Math.floor(Math.random() * palette.length)]));
          ci++;
        }
      }
    }
    crowd.count = ci;
    crowd.instanceMatrix.needsUpdate = true;
    if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
    this.group.add(crowd);
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.banners) b.update(this.time);
  }
}

const GOLD = new THREE.MeshStandardMaterial({ color: 0xd9b04a, roughness: 0.5, metalness: 0.3 });
