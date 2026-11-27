import * as THREE from 'three';
import type { ElementId } from '../abilities/elements';
import type { AbilitySlot } from '../abilities/types';
import { BendingPose, type Pose } from './BendingPose';

/**
 * Büyü → hareket yakalama klibi (Quaternius UAL1/UAL2, CC0). Dizi: sırayla değişen sağ / sol hamleler.
 * Hız: klip oynatma hızı.
 */
const UP_AXIS = new THREE.Vector3(0, 1, 0);

const CAST_CLIPS: Record<string, { clips: string[]; speed: number }> = {
  earthRock: { clips: ['OverhandThrow'], speed: 1.7 },
  boulder: { clips: ['OverhandThrow'], speed: 1.2 },
  earthWall: { clips: ['Spell_Simple_Shoot'], speed: 1.4 },
  earthWave: { clips: ['Spell_Simple_Shoot'], speed: 1.2 },
  earthArmor: { clips: ['Shield_OneShot'], speed: 1.4 },
  earthArmorHeavy: { clips: ['Shield_OneShot'], speed: 1.1 },
  fireBall: { clips: ['Punch_Jab', 'Punch_Cross'], speed: 1.7 },
  lightningLine: { clips: ['Pistol_Shoot'], speed: 1.3 },
  lightningCharged: { clips: ['Pistol_Shoot'], speed: 1 },
  fireBreath: { clips: ['Spell_Simple_Shoot'], speed: 1.4 },
  fireBreathCharged: { clips: ['Spell_Simple_Shoot'], speed: 1.1 },
  waterShard: { clips: ['Sword_Regular_A', 'Sword_Regular_B'], speed: 1.8 },
  waterHeal: { clips: ['Spell_Simple_Enter'], speed: 1.4 },
  airBall: { clips: ['Melee_Hook', 'Sword_Regular_C'], speed: 1.7 },
  airSphere: { clips: ['NinjaJump_Start'], speed: 1.6 },
  bigSphere: { clips: ['NinjaJump_Start'], speed: 1.3 },
  airShockwave: { clips: ['Spell_Simple_Shoot'], speed: 1.5 },
  galeBurst: { clips: ['Sword_Heavy_Combo'], speed: 1.8 },
};

/** Süren uzun basış → tutulan üst gövde klibi */
/**
 * Rüzgar küresinin üstünde bağdaş (karakter ekseninde: x öne kaldır, y dön, z yana aç; radyan).
 * Uyluklar öne ve yana açılıp yataylaşır, baldırlar içe katlanıp önde çaprazlanır, eller dizlerde.
 */
// Ölçüm (kalçaya göre, sağ/yukarı/ileri m): dizler ±0.4 yanda ~kalça hizasında, ayak bilekleri önde ortada
// çaprazlanır (sol önde), eller dizlerin üstünde. Boşta klibi sağ bacağı biraz aşağıda tuttuğu için sağ uyluk daha çok kalkar.
const SIT_POSE: Pose = {
  thigh_l: [1.3, 0, -0.75],
  thigh_r: [1.72, 0, 0.75],
  calf_l: [0, -2.35, 0],
  calf_r: [0, 2.35, 0],
  foot_l: [0, 0.4, 0],
  foot_r: [0, -0.4, 0],
  spine_01: [0.08, 0, 0],
  upperarm_l: [0.55, 0, -0.12],
  upperarm_r: [0.55, 0, 0.12],
  lowerarm_l: [0.15, 0, 0],
  lowerarm_r: [0.15, 0, 0],
};
/** Kalça kemiğinin oturma yüzeyinden yüksekliği (kalça kası kalınlığı, m) */
const SEAT_THICKNESS = 0.16;

/** Tek elle tutulanlar: klibin yalnızca sağ kolu oynar (Alev Akımı: sağ el öne uzanır, ateş elden çıkar) */
const ONE_HAND_HOLDS = new Set(['flameStream']);

const HOLD_CLIPS: Record<string, string> = {
  lightningCharged: 'Pistol_Aim_Up',
  boulder: 'Spell_Simple_Idle_Loop',
  fireBreathCharged: 'Spell_Simple_Idle_Loop',
  icicleStream: 'Pistol_Aim_Neutral',
  flameStream: 'Pistol_Aim_Neutral',
  tornado: 'Pistol_Aim_Neutral',
};

/** Animasyonu etkileyen dövüşçü durumu (main her karede verir) */
export interface FighterAnimState {
  chargeId: string | null;
  /** Aktif element (dururken savaş duruşu için; kuklalarda null) */
  element: ElementId | null;
  /** Su Küresi içinde */
  waterSphere: boolean;
  /** Rüzgar küresine binmiş */
  riding: boolean;
  /** Bindiği rüzgar küresinin yarıçapı (m); binmiyorsa 0 */
  rideRadius: number;
  /** 0 = ayakta; yere düşmüşse 0→1 ilerleme */
  downedProgress: number;
}
import { GameConfig } from '../config/gameConfig';
import { wrapAngle } from '../core/math';
import type { MoveState } from '../game/PlayerController';
import { CharacterInstance, type AnimKey, type CharacterAsset } from './CharacterAsset';
import { EarthArmorSuit } from './EarthArmorSuit';

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
  /** Yere düşme pozu için ayak hizasında devrilen ara grup */
  private readonly tilt = new THREE.Group();
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
  /** Esneme-sıkışma yayı (+ = basık / iniş, - = uzun / sıçrayış) */
  private squash = 0;
  private squashV = 0;
  private wasGrounded = true;
  private lastVy = 0;
  /** Darbe parlaması: anında yanar, yumuşakça söner */
  private flash = 0;
  /** Koşarken dönüşe doğru yatma (motosiklet gibi, ayak ekseninde) */
  private bank = 0;
  private prevYaw: number | null = null;
  private castSide = 1;
  private idleTime = Math.random() * 10;
  /** Hazır 3D model yüklendiyse onun örneği (yoksa prosedürel iskelet çizilir). */
  private model: CharacterInstance | null = null;
  /** Toprak Zırhı kaplaması (model varsa) */
  private earthSuit: EarthArmorSuit | null = null;
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
    this.root.add(this.tilt);
    this.tilt.add(this.body);

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

  /** El ve ayak kemikleri (model varsa): dash görselleri için */
  private limbBones: THREE.Object3D[] = [];

  /**
   * Dünya koordinatında sol el, sağ el, sol ayak, sağ ayak.
   * Model yoksa karakterin köküne göre yaklaşık noktalar.
   */
  limbPoints(out: THREE.Vector3[]): void {
    if (this.limbBones.length === 4) {
      for (let i = 0; i < 4; i++) this.limbBones[i].getWorldPosition(out[i]);
      return;
    }
    const s = GameConfig.player.height / 1.8;
    const local = [
      [-0.38, 1.0, 0.1],
      [0.38, 1.0, 0.1],
      [-0.13, 0.08, 0],
      [0.13, 0.08, 0],
    ];
    for (let i = 0; i < 4; i++) out[i].set(local[i][0] * s, local[i][1] * s, local[i][2] * s).applyMatrix4(this.root.matrixWorld);
  }

  private headBone: THREE.Object3D | null = null;

  /** Sağ avuç (dünya): Alev Akımı bu elden çıkar */
  handPoint(out: THREE.Vector3): THREE.Vector3 {
    const yaw = this.root.rotation.y;
    if (this.limbBones.length === 4) {
      this.limbBones[1].getWorldPosition(out);
      // Avucun önüne doğru biraz
      return out.add(new THREE.Vector3(-Math.sin(yaw) * 0.12, 0, -Math.cos(yaw) * 0.12));
    }
    const s = GameConfig.player.height / 1.8;
    return out.set(0.3 * s, 1.35 * s, -0.5 * s).applyMatrix4(this.root.matrixWorld);
  }

  /** Ağız / baş hizası (dünya): ateş nefesi için */
  headPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.headBone) {
      this.headBone.getWorldPosition(out);
      // Yüzün önüne doğru biraz
      return out.add(new THREE.Vector3(-Math.sin(this.root.rotation.y) * 0.12, 0.02, -Math.cos(this.root.rotation.y) * 0.12));
    }
    const s = GameConfig.player.height / 1.8;
    return out.set(0, 1.62 * s, -0.12).applyMatrix4(this.root.matrixWorld);
  }

  /** Bir yetenek çıktığında çağrılır: kısa, sert bir itme/yumruk hamlesi. */
  triggerCast(info?: { element: ElementId; slot: AbilitySlot; id: string }): void {
    this.castPulse = 1;
    this.castSide = -this.castSide;
    if (!this.model) return;
    const m = info ? CAST_CLIPS[info.id] : undefined;
    if (m) {
      const names = m.clips.filter((n) => this.model!.hasClip(n));
      if (names.length) {
        this.castIndex = (this.castIndex + 1) % names.length;
        // Koşarken / havadayken yalnızca üst gövde: bacaklar harekete devam eder
        this.model.playNamedOnce(names[this.castIndex % names.length], m.speed, this.moving);
        return;
      }
      if (m.clips.length === 0) return;
    }
    this.model.playOnce(this.castSide > 0 && this.model.has('punch') ? 'punch' : 'cast');
  }

  /** Darbe aldı: küçük darbede üst gövde sarsılır, büyükte geri savrulur */
  triggerHit(amount: number): void {
    if (!this.model || this.anim.downedProgress > 0 || this.anim.waterSphere) return;
    if (amount >= 15 && this.model.hasClip('Hit_Knockback')) this.model.playNamedOnce('Hit_Knockback', 1.6, this.moving);
    else if (this.model.hasClip('Hit_Chest')) this.model.playNamedOnce(amount >= 8 ? 'Hit_Chest' : 'Hit_Head', 1.8, true);
  }

  /** Yana / geri yürüme: alt gövdenin hareket yönüne dönüşü (yumuşatılmış) */
  private legYaw = 0;
  private strafeBones: THREE.Object3D[] | null = null;
  private readonly sq = new THREE.Quaternion();
  private readonly pq2 = new THREE.Quaternion();
  private readonly fq = new THREE.Quaternion();

  /**
   * Kalçayı hareket yönüne çevir, gövdeyi nişana geri döndür: yana yürürken bacaklar yana adım atar,
   * üst gövde ve kollar ileri bakar. Arkaya yürürken koşu klibi tersten oynar (bacak dönüşü küçük kalır).
   */
  private strafeTwist(dt: number, target: number): void {
    const m = this.model!;
    if (!this.strafeBones) {
      const names = ['pelvis', 'spine_01', 'spine_02', 'spine_03'];
      const b = names.map((n) => m.root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
      this.strafeBones = b.length === 4 ? b : [];
    }
    this.legYaw += (target - this.legYaw) * damp(10, dt);
    if (this.strafeBones.length !== 4 || Math.abs(this.legYaw) < 1e-3) return;
    const [pelvis, s1, s2, s3] = this.strafeBones;
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(this.fq);
    const turn = (bone: THREE.Object3D, ang: number) => {
      bone.parent!.updateWorldMatrix(true, false);
      bone.parent!.getWorldQuaternion(this.pq2);
      // Karakter ekseninde Y dönüşü → kemik yereli
      this.sq.setFromAxisAngle(UP_AXIS, ang);
      const world = this.fq.clone().multiply(this.sq).multiply(this.fq.clone().invert());
      bone.quaternion.premultiply(this.pq2.clone().invert().multiply(world).multiply(this.pq2));
      bone.updateMatrixWorld(true);
    };
    turn(pelvis, this.legYaw);
    turn(s1, -this.legYaw * 0.35);
    turn(s2, -this.legYaw * 0.35);
    turn(s3, -this.legYaw * 0.3);
  }

  /** Kemiğin bağlama pozunda karakterin ilerisine bakan yerel ekseni (yön sabitleyici için) */
  private fwdLocal = new Map<THREE.Object3D, THREE.Vector3>();
  /** Büyü / darbe klibi ağırlığı (sabitleyici yumuşak girip çıkar) */
  private shotW = 0;
  private readonly yq = new THREE.Quaternion();
  private readonly yv = new THREE.Vector3();

  private captureForward(bones: THREE.Object3D[]): void {
    this.root.updateMatrixWorld(true);
    const yaw = this.root.rotation.y;
    for (const b of bones) {
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      this.fwdLocal.set(b, fwd.applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert()));
    }
  }

  /** Kemiğin dünya XZ düzlemindeki bakış açısı (oyun yaw kuralıyla); dik bakıyorsa null */
  private boneYaw(bone: THREE.Object3D): number | null {
    const f = this.fwdLocal.get(bone);
    if (!f) return null;
    this.yv.copy(f).applyQuaternion(bone.getWorldQuaternion(this.yq));
    if (Math.hypot(this.yv.x, this.yv.z) < 0.3) return null;
    return Math.atan2(-this.yv.x, -this.yv.z);
  }

  private yawBone(bone: THREE.Object3D, ang: number): void {
    bone.parent!.updateWorldMatrix(true, false);
    bone.parent!.getWorldQuaternion(this.pq2);
    this.sq.setFromAxisAngle(UP_AXIS, ang);
    bone.quaternion.premultiply(this.pq2.clone().invert().multiply(this.sq).multiply(this.pq2));
    bone.updateMatrixWorld(true);
  }

  /**
   * Yön sabitleyici: hareket yakalama büyü / darbe kliplerinin çoğu kalçayı ve gövdeyi 50–90° (kılıç kombolarında
   * neredeyse tam tur) döndürür. Koşarken bu dönüş bacakların üstüne binince karakter kendi etrafında dönüyormuş
   * gibi görünür. Klip oynarken kalça (yürüme yönü) ve göğüs (nişan yönü) belirli bir sapmanın ötesine geçemez;
   * kollar ve kısa gövde hareketleri korunur.
   */
  private stabilizeYaw(dt: number): void {
    const m = this.model!;
    // Klip başlar başlamaz tam etki (kısa kliplerde ilk kareler de dönmesin), bitince yumuşak bırak
    this.shotW = m.shotActive ? 1 : this.shotW * (1 - damp(12, dt));
    if (this.shotW < 0.01 || this.strafeBones?.length !== 4) return;
    const [pelvis, , s2, s3] = this.strafeBones;
    const aim = this.root.rotation.y;
    const S = GameConfig.anim.castYaw;
    const clampExcess = (err: number, limit: number) => Math.sign(err) * Math.max(0, Math.abs(err) - limit);
    const py = this.boneYaw(pelvis);
    if (py !== null) this.yawBone(pelvis, -clampExcess(wrapAngle(py - aim - this.legYaw), S.pelvisMax) * this.shotW);
    const cy = this.boneYaw(s3);
    if (cy !== null) this.yawBone(s2, -clampExcess(wrapAngle(cy - aim), S.chestMax) * this.shotW);
  }

  /** Dururken elemente göre savaş duruşu (yalnızca duruş; büyü hareketlerini klipler yapar) */
  private bend: BendingPose | null = null;
  /** Bağdaş ağırlığı, son bindiği kürenin yarıçapı, bağlama pozunda kalçanın kökten yüksekliği */
  private sitW = 0;
  private lastRideR = 1;
  private pelvisHeight = 0.86;
  /** Hata ayıklama / ayar: bağdaş pozu (konsoldan değiştirilebilir) */
  readonly sitPose = SIT_POSE;
  private castIndex = 0;
  private floatLift = 0;
  private moving = false;
  private anim: FighterAnimState = { chargeId: null, element: null, waterSphere: false, riding: false, rideRadius: 0, downedProgress: 0 };

  setAnimState(s: FighterAnimState): void {
    this.anim = s;
  }

  /** Durumdan baskın klibi seç (yerde yatma > su küresi > küre binme > şarj) */
  private applyOverride(): void {
    const m = this.model!;
    const a = this.anim;
    if (a.downedProgress > 0 && m.hasClip('LayToIdle')) {
      // Önce yatar (klibin başı), son %55'te kalkar
      const dur = m.clipDuration('LayToIdle');
      const p = a.downedProgress;
      m.setOverride('LayToIdle', false, 1, p < 0.45 ? 0 : ((p - 0.45) / 0.55) * dur);
    } else if (a.waterSphere && m.hasClip('Swim_Idle_Loop')) m.setOverride('Swim_Idle_Loop');
    // Küre üstünde: sakin boşta klibi (üst gövde nefes alır), bacaklar SIT_POSE ile bağdaş kurar
    else if (a.riding && m.hasClip('Idle_Loop')) m.setOverride('Idle_Loop');
    else if (a.chargeId && HOLD_CLIPS[a.chargeId] && m.hasClip(HOLD_CLIPS[a.chargeId]))
      m.setOverride(HOLD_CLIPS[a.chargeId], ONE_HAND_HOLDS.has(a.chargeId) ? 'rightArm' : true);
    else m.setOverride(null);
  }

  /**
   * Prosedürel iskeletin yerine hazır modeli koyar. Alın bandı (element rengi) baş kemiğine takılır.
   */
  attachModel(asset: CharacterAsset): void {
    if (this.model) return;
    const inst = new CharacterInstance(asset, this.clothMat.color.getHex(), this.accentMat);
    this.model = inst;
    this.tilt.add(inst.root);
    const bend = new BendingPose(inst.root);
    this.bend = bend.ok ? bend : null;
    const pelvisBone = inst.root.getObjectByName('pelvis');
    if (pelvisBone) {
      inst.root.updateMatrixWorld(true);
      this.pelvisHeight = pelvisBone.getWorldPosition(new THREE.Vector3()).y - inst.root.getWorldPosition(new THREE.Vector3()).y;
    }
    // Bağlama pozunda kalça / göğüs ileri ekseni (büyü kliplerinde yön sabitleyici)
    this.captureForward(['pelvis', 'spine_03'].map((n) => inst.root.getObjectByName(n)).filter(Boolean) as THREE.Object3D[]);
    const bones = ['hand_l', 'hand_r', 'foot_l', 'foot_r'].map((n) => inst.root.getObjectByName(n));
    if (bones.every(Boolean)) this.limbBones = bones as THREE.Object3D[];
    this.headBone = inst.head ?? inst.root.getObjectByName('head') ?? null;
    this.body.visible = false;
    for (const m of inst.materials) this.mats.push(m);
    inst.root.updateMatrixWorld(true);
    const suit = new EarthArmorSuit(inst.root);
    this.earthSuit = suit.ok ? suit : null;
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

  /**
   * Toprak Zırhı görseli: tüm vücut taş pullarla kaplanır. frac = kalan zırh oranı (0 = yok).
   * Model yoksa false döner (çağıran eski plaka görseline düşer).
   */
  setEarthArmor(frac: number, heavy: boolean, dt: number): boolean {
    if (!this.earthSuit) return false;
    this.earthSuit.update(frac, heavy, dt);
    return true;
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
    this.applyOverride();
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
    /** Üşüme 0..1 (1 = donmuş) */
    chill = 0,
    /** Yanıyor mu */
    burning = false,
    /** 0 = ayakta, 1 = sırtüstü yerde */
    downed = 0,
  ): void {
    // Sırtüstü devril (ayak ekseni etrafında), kalkarken geri dön
    // Model yerden kalkma klibiyle yatar; prosedürel karakter devrilir
    const tiltDown = this.model?.hasClip('LayToIdle') ? 0 : downed;
    this.tilt.rotation.x = (Math.PI / 2) * tiltDown;
    this.tilt.position.y = 0.22 * tiltDown;
    // Su küresinde: yüzme pozunda kürenin ortasında süzülür
    // Karakterin ortası kürenin ortasına (küre zemine oturur: merkez = yarıçap). Yüzme klibinde gövde
    // kökten ~0.15 m yukarıda durur; model yoksa prosedürel gövdenin ortası boy / 2.
    const sphereLift = GameConfig.water.sphere.radius * 1.02 - (this.model ? 0.15 : GameConfig.player.height * 0.5);
    this.floatLift += ((this.anim.waterSphere && this.model ? sphereLift : 0) - this.floatLift) * damp(6, dt);
    this.tilt.position.y += this.floatLift + Math.sin(this.idleTime * 2) * 0.05 * this.floatLift;
    if (chill >= 1) dt = 0; // donmuşken animasyon durur
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
    this.moving = speed > 1.5 || !grounded;
    const fwdSpeed = vx * this.fwd.x + vz * this.fwd.z;
    const sideSpeed = vx * -this.fwd.z + vz * this.fwd.x; // sağa pozitif
    const run = GameConfig.player.runSpeed;
    const sliding = state === 'sliding' || heightRatio < 0.8;
    const gliding = state === 'gliding' || state === 'floating';

    // Esneme-sıkışma: iniş basar, sıçrayış uzatır; yay ile birkaç kez esneyip oturur (canlı, "çizgi film" his)
    const vy = v?.y ?? 0;
    if (grounded && !this.wasGrounded && this.lastVy < -3) this.squashV += Math.min(2.6, 0.6 + (-this.lastVy - 3) * 0.16);
    else if (!grounded && this.wasGrounded && vy > 3) this.squashV -= 1.5;
    this.wasGrounded = grounded;
    this.lastVy = vy;
    {
      const h = Math.min(dt, 1 / 30);
      this.squashV += (-320 * this.squash - 20 * this.squashV) * h;
      this.squash = Math.max(-0.16, Math.min(0.2, this.squash + this.squashV * h));
    }
    // Dönüşe yatma: hızlı koşarken yön değişimi gövdeyi ayaklardan içe doğru yatırır
    const yawRate = this.prevYaw === null || dt <= 0 ? 0 : wrapAngle(yaw - this.prevYaw) / dt;
    this.prevYaw = yaw;
    const bankTarget = grounded && !sliding && !dashing ? Math.max(-0.1, Math.min(0.1, yawRate * 0.025 * Math.min(1, speed / run))) : 0;
    this.bank += (bankTarget - this.bank) * damp(8, dt);
    this.tilt.rotation.z = this.model && downed <= 0 && !this.anim.riding ? this.bank : 0;
    const sq = this.anim.riding || downed > 0 ? 0 : this.squash;
    this.tilt.scale.set(1 + sq * 0.55, 1 - sq, 1 + sq * 0.55);

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
      let legTarget = 0;
      let key: AnimKey = 'idle';
      let ts = 1;
      if (dashing) key = 'dash';
      else if (state === 'crouching') {
        // Eğik dururken çömelme pozu sabit kalır, yürürken hızla oynar
        key = 'slide';
        ts = speed > 0.3 ? Math.max(0.5, Math.min(1.4, speed / (run * GameConfig.slide.crouchSpeedMult))) : 0;
      } else if (sliding) key = 'slide';
      else if (gliding) key = 'glide';
      else if (!grounded) key = (v?.y ?? 0) > 0 ? 'jump' : 'fall';
      else if (speed > 0.8) {
        key = 'run';
        ts = Math.max(0.6, Math.min(1.6, speed / run));
        // Hareket yönü (karakter ekseninde, sola pozitif): yana → bacaklar o yöne; arkaya → tersten koşu
        const a = Math.atan2(-sideSpeed, fwdSpeed);
        if (Math.abs(a) > 1.95) {
          ts = -ts;
          legTarget = Math.max(-0.6, Math.min(0.6, a - Math.PI * Math.sign(a)));
        } else legTarget = Math.max(-1.25, Math.min(1.25, a));
      } else if (castProgress > 0 && this.model.has('charge')) key = 'charge';
      this.animateModel(dt, key, ts);
      this.strafeTwist(dt, legTarget);
      this.stabilizeYaw(dt);
      if (this.bend) {
        // Dururken elemente göre savaş duruşu (kemik pozu). Büyü / darbe / şarj klipleri oynarken,
        // koşarken, havada, kayarken, dash'te, donukken ve yerdeyken söner; hareketleri klipler yapar.
        const stance =
          key === 'idle' && grounded && speed < 1.5 && !this.model.busy && chill < 1 && downed <= 0 && !this.anim.waterSphere ? 1 : 0;
        this.bend.apply(dt, { element: this.anim.element, stance, chargeId: null, chargeProgress: 0 }, this.root);
        this.tilt.position.y -= this.bend.drop * (1 - downed);
      }
      // Rüzgar küresinin üstünde bağdaş kurup oturur
      if (this.anim.rideRadius > 0) this.lastRideR = this.anim.rideRadius;
      this.sitW += ((this.anim.riding ? 1 : 0) - this.sitW) * damp(12, dt);
      if (this.sitW > 0.01 && this.bend) {
        this.bend.applyStatic(SIT_POSE, this.sitW, this.root);
        // Kalça kürenin tepesine: küre merkezi ayak − 0.9r → tepe ayak + 0.1r; model kökü kalça yüksekliği kadar iner
        this.tilt.position.y += (0.1 * this.lastRideR + SEAT_THICKNESS - this.pelvisHeight) * this.sitW;
      }
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
    this.flash = hitFlash ? 1 : Math.max(0, this.flash - dt * 7);
    this.accentMat.color.setHex(elementColor);
    this.accentMat.emissive.setHex(elementColor);
    this.accentMat.emissiveIntensity = 0.35;
    this.handMat.emissive.setHex(elementColor);
    this.handMat.emissiveIntensity = Math.max(cp, p) * 1.2;
    for (const m of this.mats) {
      if (m === this.accentMat || m === this.handMat) continue;
      if (this.flash > 0.02) {
        // Beyazdan sıcak kırmızıya kayan, yumuşak sönen darbe parlaması
        m.emissive.setRGB(1, 0.55 + 0.45 * this.flash, 0.45 + 0.55 * this.flash);
        m.emissiveIntensity = 1.1 * this.flash;
      } else if (burning) {
        m.emissive.setHex(0xff5a1a);
        m.emissiveIntensity = 0.25 + Math.random() * 0.3;
      } else if (chill > 0) {
        m.emissive.setHex(chill >= 1 ? 0xbfefff : 0x4fb8ff);
        m.emissiveIntensity = chill >= 1 ? 0.9 : 0.15 + chill * 0.35;
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
