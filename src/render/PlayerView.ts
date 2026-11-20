import * as THREE from 'three';
import { GameConfig } from '../config/gameConfig';
import type { MoveState } from '../game/PlayerController';
import { CharacterInstance, type AnimKey, type CharacterAsset } from './CharacterAsset';

/** Animasyonu süren hareket bilgisi (mantıktan salt okunur). */
export interface FighterMotion {
  velocity: THREE.Vector3;
  grounded: boolean;
  state: MoveState;
}

const SKIN = 0xc98b5e;
const PANTS = 0x2f3340;
const BOOTS = 0x3a2a1e;

/** Pivot grubu + ondan aşağı sarkan bir uzuv parçası. */
function limb(mat: THREE.Material, w: number, len: number, d: number, taper = 0.85): { pivot: THREE.Group; mesh: THREE.Mesh } {
  const pivot = new THREE.Group();
  const geo = new THREE.CylinderGeometry(w * taper, w, len, 7, 1);
  geo.translate(0, -len / 2, 0);
  geo.scale(1, 1, d / w);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  pivot.add(mesh);
  return { pivot, mesh };
}

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/**
 * İnsansı, düşük poligonlu dövüşçü (prosedürel iskelet + prosedürel animasyon).
 * Koşu döngüsü, zıplama/düşüş, kayma çömelmesi, dash eğilmesi, büküm hazırlığı ve vuruş hamlesi.
 * Mantıktan yalnızca durum okur; dışarıdan model dosyası gerektirmez.
 */
export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group(); // kalça yüksekliğinde, eğilme burada
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = { shoulder: new THREE.Group(), elbow: new THREE.Group() };
  private readonly armR = { shoulder: new THREE.Group(), elbow: new THREE.Group() };
  private readonly legL = { hip: new THREE.Group(), knee: new THREE.Group() };
  private readonly legR = { hip: new THREE.Group(), knee: new THREE.Group() };
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly clothMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly handMat: THREE.MeshStandardMaterial;

  // Animasyon durumu
  private phase = 0;
  private runBlend = 0;
  private airBlend = 0;
  private lean = 0;
  private sideLean = 0;
  private castPulse = 0; // 1 → 0: yeteneğin çıktığı anki hamle
  private castSide = 1;
  private idleTime = Math.random() * 10;
  /** Hazır 3D model yüklendiyse onun örneği (yoksa prosedürel iskelet çizilir). */
  private model: CharacterInstance | null = null;
  private readonly fwd = new THREE.Vector3();

  constructor(scene: THREE.Scene, color = 0x3fa7ff) {
    const mk = (c: number, rough = 0.75) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, flatShading: true, emissive: 0x000000 });
      this.mats.push(m);
      return m;
    };
    const skin = mk(SKIN, 0.6);
    this.clothMat = mk(color);
    const pants = mk(PANTS);
    const boots = mk(BOOTS, 0.9);
    this.accentMat = mk(0x1b1f2a, 0.4);
    this.handMat = mk(SKIN, 0.6);

    const H = GameConfig.player.height; // 1.8 baz alınarak orantılı
    const s = H / 1.8;

    // Gövde: kalça → göğüs
    this.body.position.y = 0.92 * s;
    this.root.add(this.body);

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36 * s, 0.16 * s, 0.22 * s), pants);
    pelvis.castShadow = true;
    this.body.add(pelvis);

    this.torso.position.y = 0.06 * s;
    this.body.add(this.torso);
    const chestGeo = new THREE.CylinderGeometry(0.22 * s, 0.17 * s, 0.5 * s, 7, 1);
    chestGeo.translate(0, 0.25 * s, 0);
    chestGeo.scale(1, 1, 0.68);
    const chest = new THREE.Mesh(chestGeo, this.clothMat);
    chest.castShadow = true;
    this.torso.add(chest);
    // Bel kuşağı (element rengi)
    const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.185 * s, 0.185 * s, 0.07 * s, 8, 1), this.accentMat);
    sash.scale.z = 0.72;
    sash.position.y = 0.03 * s;
    this.torso.add(sash);
    // Omuz örtüsü
    const mantle = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.08 * s, 0.22 * s), this.clothMat);
    mantle.position.y = 0.47 * s;
    mantle.castShadow = true;
    this.torso.add(mantle);

    // Baş
    this.head.position.y = 0.52 * s;
    this.torso.add(this.head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * s, 0.065 * s, 0.1 * s, 6), skin);
    neck.position.y = 0.04 * s;
    this.head.add(neck);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13 * s, 1), skin);
    skull.scale.set(0.95, 1.1, 1);
    skull.position.y = 0.18 * s;
    skull.castShadow = true;
    this.head.add(skull);
    // Alın bandı (element rengi) + arka düğüm
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.133 * s, 0.133 * s, 0.045 * s, 10, 1, true), this.accentMat);
    band.position.y = 0.21 * s;
    this.head.add(band);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.05 * s, 0.12 * s), this.accentMat);
    knot.position.set(0, 0.2 * s, 0.15 * s);
    knot.rotation.x = 0.5;
    this.head.add(knot);

    // Kollar (omuz pivotu göğüs üst köşesinde)
    const buildArm = (arm: { shoulder: THREE.Group; elbow: THREE.Group }, side: number) => {
      arm.shoulder.position.set(0.27 * s * side, 0.44 * s, 0);
      this.torso.add(arm.shoulder);
      const upper = limb(this.clothMat, 0.065 * s, 0.28 * s, 0.065 * s);
      arm.shoulder.add(upper.pivot);
      arm.elbow.position.y = -0.28 * s;
      arm.shoulder.add(arm.elbow);
      const fore = limb(skin, 0.05 * s, 0.25 * s, 0.05 * s);
      arm.elbow.add(fore.pivot);
      const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06 * s, 0), this.handMat);
      hand.position.y = -0.29 * s;
      hand.castShadow = true;
      arm.elbow.add(hand);
    };
    buildArm(this.armL, -1);
    buildArm(this.armR, 1);

    // Bacaklar
    const buildLeg = (leg: { hip: THREE.Group; knee: THREE.Group }, side: number) => {
      leg.hip.position.set(0.11 * s * side, -0.05 * s, 0);
      this.body.add(leg.hip);
      const thigh = limb(pants, 0.085 * s, 0.42 * s, 0.09 * s, 0.8);
      leg.hip.add(thigh.pivot);
      leg.knee.position.y = -0.42 * s;
      leg.hip.add(leg.knee);
      const shin = limb(pants, 0.07 * s, 0.4 * s, 0.075 * s, 0.75);
      leg.knee.add(shin.pivot);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.22 * s), boots);
      foot.position.set(0, -0.42 * s, -0.05 * s);
      foot.castShadow = true;
      leg.knee.add(foot);
    };
    buildLeg(this.legL, -1);
    buildLeg(this.legR, 1);

    scene.add(this.root);
  }

  /** Bir yetenek çıktığında çağrılır: kısa, sert bir itme/yumruk hamlesi. */
  triggerCast(): void {
    this.castPulse = 1;
    this.castSide = -this.castSide;
    if (this.model) this.model.playOnce(this.castSide > 0 && this.model.has('punch') ? 'punch' : 'cast');
  }

  /**
   * Prosedürel iskeletin yerine hazır modeli koyar. Alın bandı (element rengi) baş kemiğine takılır.
   */
  attachModel(asset: CharacterAsset): void {
    if (this.model) return;
    const inst = new CharacterInstance(asset, this.clothMat.color.getHex(), this.accentMat);
    this.model = inst;
    this.root.add(inst.root);
    this.body.visible = false;
    for (const m of inst.materials) this.mats.push(m);
    inst.root.updateMatrixWorld(true);
    if (inst.head) {
      const g = this.boneSpace(inst, inst.head);
      // g modelin kök eksenlerinde (model +Z'ye bakar, arka -Z), birim = metre
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.112, 0.045, 14, 1, true), this.accentMat);
      band.position.set(0, 0.1, 0.012);
      g.add(band);
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.11), this.accentMat);
      knot.position.set(0, 0.09, -0.15);
      knot.rotation.x = 0.6;
      g.add(knot);
    }
    // Bel kuşağı: kıyafet bölgelerinin tırtıklı sınırını örten düzgün kumaş bant (element rengi)
    const pelvis = inst.root.getObjectByName('pelvis') ?? inst.root.getObjectByName('spine_01');
    if (pelvis) {
      const g = this.boneSpace(inst, pelvis);
      const rootY = inst.root.getWorldPosition(new THREE.Vector3()).y;
      const boneY = pelvis.getWorldPosition(new THREE.Vector3()).y - rootY;
      const waistY = 1.015 * (GameConfig.player.height / 1.8);
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.18, 0.13, 16, 1, true), this.accentMat);
      belt.scale.z = 0.78;
      belt.position.set(0, waistY - boneY, 0.005);
      g.add(belt);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.02), this.accentMat);
      tail.position.set(0.09, waistY - boneY - 0.13, -0.135);
      tail.rotation.z = 0.12;
      g.add(tail);
    }
  }

  /** Kemiğe, modelin kök eksenleriyle hizalı ve metre ölçekli bir bağlama grubu ekler. */
  private boneSpace(inst: CharacterInstance, bone: THREE.Object3D): THREE.Group {
    const bq = bone.getWorldQuaternion(new THREE.Quaternion());
    const rq = inst.root.getWorldQuaternion(new THREE.Quaternion());
    const bs = bone.getWorldScale(new THREE.Vector3()).x || 1;
    const g = new THREE.Group();
    g.quaternion.copy(bq.invert().multiply(rq));
    g.scale.setScalar(1 / bs);
    bone.add(g);
    return g;
  }

  private animateModel(dt: number, key: AnimKey, timeScale: number): void {
    const m = this.model!;
    m.play(m.has(key) ? key : key === 'runBack' || key === 'dash' ? 'run' : 'idle', timeScale);
    m.update(dt);
  }

  update(
    position: THREE.Vector3,
    yaw: number,
    heightRatio: number,
    dashing: boolean,
    cameraDistance: number,
    elementColor = 0x1b1f2a,
    castProgress = 0,
    motion?: FighterMotion,
    dt = 1 / 60,
    hitFlash = false,
  ): void {
    this.root.position.copy(position);
    this.root.rotation.y = yaw;

    // --- Hareket analizi (yerel eksen: ileri = -Z)
    const v = motion?.velocity;
    const grounded = motion?.grounded ?? true;
    const state = motion?.state ?? 'grounded';
    this.fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const vx = v?.x ?? 0;
    const vz = v?.z ?? 0;
    const speed = Math.hypot(vx, vz);
    const fwdSpeed = vx * this.fwd.x + vz * this.fwd.z;
    const sideSpeed = vx * -this.fwd.z + vz * this.fwd.x; // sağa pozitif
    const run = GameConfig.player.runSpeed;
    const sliding = state === 'sliding' || heightRatio < 0.8;
    const gliding = state === 'gliding' || state === 'floating';

    this.runBlend += ((grounded && !sliding ? Math.min(1, speed / run) : 0) - this.runBlend) * damp(12, dt);
    this.airBlend += ((grounded ? 0 : 1) - this.airBlend) * damp(10, dt);
    const dir = fwdSpeed < -0.5 ? -1 : 1;
    this.phase += dt * (4 + 8 * Math.min(1.4, speed / run)) * dir;
    this.idleTime += dt;
    this.castPulse = Math.max(0, this.castPulse - dt * 3.5);

    const targetLean = dashing ? 0.55 : sliding ? -0.15 : Math.max(-0.25, Math.min(0.35, (fwdSpeed / run) * 0.22));
    this.lean += (targetLean - this.lean) * damp(10, dt);
    this.sideLean += (Math.max(-0.25, Math.min(0.25, -(sideSpeed / run) * 0.15)) - this.sideLean) * damp(8, dt);

    if (this.model) {
      let key: AnimKey = 'idle';
      let ts = 1;
      if (dashing) key = 'dash';
      else if (sliding) key = 'slide';
      else if (gliding) key = 'glide';
      else if (!grounded) key = (v?.y ?? 0) > 0 ? 'jump' : 'fall';
      else if (speed > 0.8) {
        key = fwdSpeed < -0.5 && this.model.has('runBack') ? 'runBack' : 'run';
        ts = Math.max(0.6, Math.min(1.6, speed / run));
      } else if (castProgress > 0 && this.model.has('charge')) key = 'charge';
      this.animateModel(dt, key, ts);
    }

    const sw = Math.sin(this.phase);
    const r = this.runBlend;
    const a = this.airBlend;
    const breath = Math.sin(this.idleTime * 2.2) * 0.015 * (1 - r);
    const rise = (v?.y ?? 0) > 0 ? 1 : 0;

    // --- Gövde
    const s = GameConfig.player.height / 1.8;
    const crouch = sliding ? 0.42 : 0;
    const bob = Math.abs(Math.cos(this.phase)) * 0.06 * r;
    this.body.position.y = (0.92 - crouch + bob + breath) * s;
    this.body.rotation.x = -this.lean;
    this.body.rotation.z = this.sideLean;
    this.torso.rotation.y = -sw * 0.18 * r;
    this.head.rotation.y = sw * 0.12 * r;

    // --- Bacaklar
    const legSwing = 0.9 * r;
    let hipL = sw * legSwing;
    let hipR = -sw * legSwing;
    let kneeL = (Math.max(0, -Math.cos(this.phase)) * 1.2 + 0.1) * r;
    let kneeR = (Math.max(0, Math.cos(this.phase)) * 1.2 + 0.1) * r;
    // Havada: tek diz yukarı, diğeri sarkık (yükselirken), düşerken bacaklar açık
    hipL = hipL * (1 - a) + a * (rise ? -0.9 : -0.35);
    hipR = hipR * (1 - a) + a * (rise ? 0.25 : 0.3);
    kneeL = kneeL * (1 - a) + a * (rise ? 1.4 : 0.6);
    kneeR = kneeR * (1 - a) + a * (rise ? 0.3 : 0.5);
    if (sliding) {
      // Kayma: öndeki bacak uzanır, arkadaki altta katlanır
      hipL = -1.3;
      kneeL = 0.2;
      hipR = 0.2;
      kneeR = 1.9;
    }
    if (gliding) {
      hipL = -0.15;
      hipR = 0.35;
      kneeL = 0.35;
      kneeR = 0.6;
    }
    this.legL.hip.rotation.x = -hipL;
    this.legR.hip.rotation.x = -hipR;
    // Diz yalnızca geriye bükülür
    this.legL.knee.rotation.x = -kneeL;
    this.legR.knee.rotation.x = -kneeR;
    this.legL.hip.rotation.z = -0.04 - 0.15 * a;
    this.legR.hip.rotation.z = 0.04 + 0.15 * a;

    // --- Kollar: koşu salınımı + havada denge + büküm duruşu
    let shL = -sw * 0.8 * r;
    let shR = sw * 0.8 * r;
    let elL = 0.4 + 0.6 * r;
    let elR = 0.4 + 0.6 * r;
    let outL = 0.12 + 0.6 * a;
    let outR = 0.12 + 0.6 * a;
    if (gliding) {
      outL = outR = 1.3;
      elL = elR = 0.15;
      shL = shR = 0;
    }
    if (dashing) {
      shL = shR = 0.9;
      elL = elR = 0.3;
      outL = outR = 0.35;
    }
    // Hazırlık: iki el öne gelir, avuçlar enerji toplar
    const cp = Math.min(1, castProgress * 1.4);
    if (cp > 0) {
      shL = shL * (1 - cp) + cp * -1.1;
      shR = shR * (1 - cp) + cp * -1.1;
      elL = elL * (1 - cp) + cp * 1.2;
      elR = elR * (1 - cp) + cp * 1.2;
      outL = outL * (1 - cp) + cp * -0.2;
      outR = outR * (1 - cp) + cp * -0.2;
    }
    // Vuruş: bir kol ileri fırlar, gövde o yöne döner
    const p = this.castPulse > 0 ? Math.sin(Math.min(1, (1 - this.castPulse) * 1.6) * Math.PI) : 0;
    if (p > 0) {
      const punchL = this.castSide < 0;
      if (punchL) {
        shL = shL * (1 - p) + p * -1.55;
        elL *= 1 - p;
        outL = outL * (1 - p) + p * -0.15;
      } else {
        shR = shR * (1 - p) + p * -1.55;
        elR *= 1 - p;
        outR = outR * (1 - p) + p * -0.15;
      }
      this.torso.rotation.y += p * 0.45 * (punchL ? -1 : 1);
      this.body.rotation.x -= p * 0.12;
    }
    // Negatif değer = kol öne (yerel -Z); dirsek pozitif = önkol öne bükülür
    this.armL.shoulder.rotation.set(-shL, 0, -outL);
    this.armR.shoulder.rotation.set(-shR, 0, outR);
    this.armL.elbow.rotation.x = elL;
    this.armR.elbow.rotation.x = elR;

    // --- Renk / parlama
    this.accentMat.color.setHex(elementColor);
    this.accentMat.emissive.setHex(elementColor);
    this.accentMat.emissiveIntensity = 0.35;
    this.handMat.emissive.setHex(elementColor);
    this.handMat.emissiveIntensity = Math.max(cp, p) * 1.2;
    for (const m of this.mats) {
      if (m === this.accentMat || m === this.handMat) continue;
      if (hitFlash) {
        m.emissive.setHex(0xffffff);
        m.emissiveIntensity = 0.8;
      } else if (dashing) {
        m.emissive.setHex(0x66ccff);
        m.emissiveIntensity = m === this.clothMat ? 0.5 : 0.2;
      } else {
        m.emissiveIntensity = 0;
      }
    }

    // Kamera duvar yüzünden çok yaklaşırsa karakteri saydamlaştır
    const opacity = Math.min(1, Math.max(0.15, (cameraDistance - 0.6) / 1.2));
    const transparent = opacity < 0.999;
    for (const m of this.mats) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
    }
  }
}
