import * as THREE from 'three';
import type { ElementId } from '../abilities/elements';
import type { AbilitySlot } from '../abilities/types';

/**
 * Büküm dövüş sanatı pozları: hazır animasyon kliplerinin ÜSTÜNE kemik dönüşleri ekler.
 * - Elemente göre savaş duruşu (dururken):
 *     Toprak: alçak, geniş at duruşu, yumruklar önde
 *     Ateş: yan duruş, öndeki yumruk yukarıda, arkadaki çenede (gardda)
 *     Hava: hafif, parmak ucunda sekme, açık avuçlar, dairesel kol salınımı
 *     Su: dizler esnek, kollar dalga gibi akan hareket
 * - Büyü atınca elemente / slota göre kısa hareket (yere basma, yumruk, dairesel savurma, dalga)
 * - Şarj / kanal sırasında tutulan poz (yıldırım: kol havada; dev kaya: kollar başın üstünde; nefes: geriye yaslanma)
 *
 * Dönüşler karakterin kendi ekseninde verilir (X sağ, Y yukarı, ileri -Z), kemiğin yerel eksenine çevrilir.
 */

type BoneName =
  | 'pelvis'
  | 'spine_01'
  | 'spine_02'
  | 'spine_03'
  | 'neck_01'
  | 'clavicle_l'
  | 'clavicle_r'
  | 'upperarm_l'
  | 'upperarm_r'
  | 'lowerarm_l'
  | 'lowerarm_r'
  | 'hand_l'
  | 'hand_r'
  | 'thigh_l'
  | 'thigh_r'
  | 'calf_l'
  | 'calf_r'
  | 'foot_l'
  | 'foot_r';

const ORDER: BoneName[] = [
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'clavicle_l',
  'clavicle_r',
  'upperarm_l',
  'upperarm_r',
  'lowerarm_l',
  'lowerarm_r',
  'hand_l',
  'hand_r',
  'thigh_l',
  'thigh_r',
  'calf_l',
  'calf_r',
  'foot_l',
  'foot_r',
];

/** Kemik başına karakter ekseninde (x: öne kaldır / eğ, y: dön, z: yana aç) açı (radyan) */
export type Pose = Partial<Record<BoneName, [number, number, number]>>;

export interface BendState {
  element: ElementId | null;
  /** 0..1: dururken savaş duruşu ağırlığı (koşu / hava / kayma sırasında 0) */
  stance: number;
  /** Süren uzun basışın kimliği ve ilerlemesi */
  chargeId: string | null;
  chargeProgress: number;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Hareket süresi (s) */
const GESTURE_TIME = 0.5;

export class BendingPose {
  private readonly bones = new Map<BoneName, THREE.Object3D>();
  private gesture: { element: ElementId; slot: AbilitySlot; id: string; t: number; side: number } | null = null;
  private stanceW = 0;
  private chargeW = 0;
  private lastCharge: string | null = null;
  private time = 0;
  private readonly frame = new THREE.Quaternion();
  private readonly frameInv = new THREE.Quaternion();
  private readonly pq = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  private readonly acc = new Map<BoneName, THREE.Vector3>();
  private side = 1;

  constructor(skeletonRoot: THREE.Object3D) {
    for (const n of ORDER) {
      const b = skeletonRoot.getObjectByName(n);
      if (b) this.bones.set(n, b);
      this.acc.set(n, new THREE.Vector3());
    }
  }

  get ok(): boolean {
    return this.bones.has('upperarm_l') && this.bones.has('thigh_l') && this.bones.has('spine_02');
  }

  /** Büyü çıktı: elemente / slota göre hareket başlat */
  cast(element: ElementId, slot: AbilitySlot, id: string): void {
    this.side = -this.side;
    this.gesture = { element, slot, id, t: 0, side: this.side };
  }

  /** Pelvisin ne kadar alçalacağı (m): duruş + hareket */
  drop = 0;
  /** Gövdenin ek dönüşü (Hava dönüşü) */
  spin = 0;

  /**
   * Mixer güncellemesinden SONRA çağrılır.
   * frameObj: karakterin oyun eksenindeki kökü (PlayerView.root)
   */
  apply(dt: number, s: BendState, frameObj: THREE.Object3D): void {
    if (!this.ok) return;
    this.time += dt;
    const damp = (cur: number, target: number, k: number) => cur + (target - cur) * (1 - Math.exp(-k * dt));
    this.stanceW = damp(this.stanceW, s.element ? s.stance : 0, 8);
    const charging = !!s.chargeId;
    if (s.chargeId) this.lastCharge = s.chargeId;
    this.chargeW = damp(this.chargeW, charging ? 1 : 0, 10);

    for (const v of this.acc.values()) v.set(0, 0, 0);
    let drop = 0;
    let spin = 0;

    // --- 1) Savaş duruşu
    if (s.element && this.stanceW > 0.01) {
      const r = this.stance(s.element);
      this.add(r.pose, this.stanceW);
      drop += r.drop * this.stanceW;
    }

    // --- 2) Şarj / kanal pozu
    if (this.chargeW > 0.01 && this.lastCharge) {
      const r = this.chargePose(this.lastCharge, s.chargeProgress);
      this.add(r.pose, this.chargeW);
      drop += r.drop * this.chargeW;
    }

    // --- 3) Büyü hareketi
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt / GESTURE_TIME;
      if (g.t >= 1) this.gesture = null;
      else {
        const r = this.gesturePose(g.element, g.slot, g.id, g.t, g.side);
        // Giriş / çıkış yumuşak
        const w = Math.min(1, g.t * 8) * Math.min(1, (1 - g.t) * 4);
        this.add(r.pose, w);
        drop += r.drop * w;
        spin += r.spin;
      }
    }

    this.drop = drop;
    this.spin = spin;
    this.commit(frameObj);
  }

  /** Sabit poz (ör. rüzgar küresinin üstünde bağdaş): mixer güncellemesinden sonra, 0..1 ağırlıkla */
  applyStatic(pose: Pose, w: number, frameObj: THREE.Object3D): void {
    if (!this.ok || w <= 0.001) return;
    for (const v of this.acc.values()) v.set(0, 0, 0);
    this.add(pose, w);
    this.commit(frameObj);
  }

  /** Biriken dönüşleri uygula (ebeveynden çocuğa; karakter ekseni → kemik yereli) */
  private commit(frameObj: THREE.Object3D): void {
    frameObj.updateMatrixWorld(true);
    frameObj.getWorldQuaternion(this.frame);
    this.frameInv.copy(this.frame).invert();
    for (const n of ORDER) {
      const a = this.acc.get(n)!;
      if (a.lengthSq() < 1e-6) continue;
      const b = this.bones.get(n);
      if (!b || !b.parent) continue;
      b.parent.updateWorldMatrix(true, false);
      b.parent.getWorldQuaternion(this.pq);
      // Karakter eksenindeki dönüş: önce yan (z), sonra öne (x), sonra dönüş (y)
      this.q.setFromAxisAngle(Y, a.y).multiply(new THREE.Quaternion().setFromAxisAngle(X, a.x)).multiply(new THREE.Quaternion().setFromAxisAngle(Z, a.z));
      // dünya = frame * q * frame^-1 ; yerel ek = parent^-1 * dünya * parent
      const world = this.frame.clone().multiply(this.q).multiply(this.frameInv);
      const local = this.pq.clone().invert().multiply(world).multiply(this.pq);
      b.quaternion.premultiply(local);
      b.updateMatrixWorld(true);
    }
  }

  private add(p: Pose, w: number): void {
    for (const k in p) {
      const v = p[k as BoneName]!;
      this.acc.get(k as BoneName)!.add(new THREE.Vector3(v[0] * w, v[1] * w, v[2] * w));
    }
  }

  // ================================================================ duruşlar

  private stance(el: ElementId): { pose: Pose; drop: number } {
    const t = this.time;
    switch (el) {
      case 'earth': {
        // Alçak, geniş at duruşu; yumruklar önde, sabit ve ağır
        const b = Math.sin(t * 1.6) * 0.02;
        return {
          drop: 0.13 + b,
          pose: {
            thigh_l: [0.45, 0, -0.32],
            thigh_r: [0.45, 0, 0.32],
            calf_l: [-0.8, 0, 0],
            calf_r: [-0.8, 0, 0],
            foot_l: [0.3, 0, 0.1],
            foot_r: [0.3, 0, -0.1],
            spine_01: [0.12, 0, 0],
            upperarm_l: [0.55, 0, -0.15],
            upperarm_r: [0.55, 0, 0.15],
            lowerarm_l: [0.9, 0, 0],
            lowerarm_r: [0.9, 0, 0],
          },
        };
      }
      case 'fire': {
        // Yan duruş, gardda: öndeki (sol) yumruk ileri-yukarı, arkadaki (sağ) yumruk çenede
        const b = Math.sin(t * 5) * 0.02;
        return {
          drop: 0.07 + b,
          pose: {
            pelvis: [0, 0.35, 0],
            spine_02: [0.08, -0.25, 0],
            thigh_l: [0.35, 0, -0.12],
            thigh_r: [-0.15, 0, 0.12],
            calf_l: [-0.45, 0, 0],
            calf_r: [-0.4, 0, 0],
            upperarm_l: [1.05, 0, -0.1],
            lowerarm_l: [1.2, 0, 0],
            upperarm_r: [0.75, 0, 0.2],
            lowerarm_r: [1.9, 0, 0],
          },
        };
      }
      case 'air': {
        // Hafif, ayak ucunda sekme; açık avuçlar dairesel salınır
        const c = Math.sin(t * 2.4);
        const d = Math.cos(t * 2.4);
        return {
          drop: 0.02 + Math.abs(Math.sin(t * 4)) * 0.04,
          pose: {
            thigh_l: [0.2, 0, -0.08],
            thigh_r: [-0.05, 0, 0.08],
            calf_l: [-0.3, 0, 0],
            calf_r: [-0.15, 0, 0],
            spine_02: [0, c * 0.12, 0],
            upperarm_l: [0.8 + c * 0.2, 0.2 * d, -0.35],
            lowerarm_l: [0.5, 0, 0],
            upperarm_r: [0.4 - c * 0.2, -0.2 * d, 0.55],
            lowerarm_r: [0.6, 0, 0],
          },
        };
      }
      case 'water': {
        // Esnek dizler, kollar dalga gibi akar (iki kol zıt fazda)
        const w1 = Math.sin(t * 1.8);
        const w2 = Math.sin(t * 1.8 + Math.PI * 0.7);
        return {
          drop: 0.09,
          pose: {
            thigh_l: [0.3, 0, -0.15],
            thigh_r: [0.3, 0, 0.15],
            calf_l: [-0.55, 0, 0],
            calf_r: [-0.55, 0, 0],
            spine_01: [0, w1 * 0.1, w1 * 0.04],
            spine_02: [0.05, w1 * 0.08, 0],
            upperarm_l: [0.7 + w1 * 0.25, 0.25, -0.3 - w2 * 0.15],
            lowerarm_l: [0.5 + w2 * 0.3, 0, 0],
            hand_l: [w2 * 0.4, 0, 0],
            upperarm_r: [0.7 + w2 * 0.25, -0.25, 0.3 + w1 * 0.15],
            lowerarm_r: [0.5 + w1 * 0.3, 0, 0],
            hand_r: [w1 * 0.4, 0, 0],
          },
        };
      }
    }
  }

  // ================================================================ şarj pozları

  private chargePose(id: string, p: number): { pose: Pose; drop: number } {
    const shake = Math.sin(this.time * 40) * 0.03 * p;
    switch (id) {
      case 'lightningCharged':
        // İki parmak: sağ kol havaya, sol kol öne; enerji topladıkça gövde geriye
        return {
          drop: 0.06,
          pose: {
            upperarm_r: [2.6 + shake, 0, 0.2],
            lowerarm_r: [0.2, 0, 0],
            upperarm_l: [1.3, 0, -0.2],
            lowerarm_l: [0.3, 0, 0],
            spine_02: [-0.15 * p, 0.2, 0],
            thigh_l: [0.3, 0, -0.15],
            calf_l: [-0.4, 0, 0],
          },
        };
      case 'boulder':
        // Dev kaya: iki kol başın üstünde, dizler bükük, ağırlık arttıkça daha da çöker
        return {
          drop: 0.1 + p * 0.08,
          pose: {
            upperarm_l: [2.7, 0, -0.35],
            upperarm_r: [2.7, 0, 0.35],
            lowerarm_l: [0.6 + shake, 0, 0],
            lowerarm_r: [0.6 - shake, 0, 0],
            spine_02: [-0.2, 0, 0],
            thigh_l: [0.45, 0, -0.3],
            thigh_r: [0.45, 0, 0.3],
            calf_l: [-0.8, 0, 0],
            calf_r: [-0.8, 0, 0],
          },
        };
      case 'fireBreathCharged':
        // Ejder nefesi: geriye yaslanıp göğsü şişir, eller ağzın yanında
        return {
          drop: 0.05,
          pose: {
            spine_01: [-0.15 * p, 0, 0],
            spine_02: [-0.25 * p, 0, 0],
            neck_01: [-0.2 * p, 0, 0],
            upperarm_l: [1.3, 0.3, -0.3],
            upperarm_r: [1.3, -0.3, 0.3],
            lowerarm_l: [1.9, 0, 0],
            lowerarm_r: [1.9, 0, 0],
            thigh_l: [0.4, 0, -0.1],
            calf_l: [-0.5, 0, 0],
          },
        };
      case 'icicleStream':
      case 'flameStream':
      case 'tornado': {
        // Kanal: iki kol öne uzanmış, nişanı yönlendirir; hafif titreşim
        const w = Math.sin(this.time * (id === 'tornado' ? 6 : 14)) * 0.08;
        return {
          drop: 0.08,
          pose: {
            upperarm_l: [1.45 + w, 0.15, -0.05],
            upperarm_r: [1.45 - w, -0.15, 0.05],
            lowerarm_l: [0.15, 0, 0],
            lowerarm_r: [0.15, 0, 0],
            spine_02: [0.12, 0, 0],
            thigh_l: [0.4, 0, -0.15],
            thigh_r: [-0.1, 0, 0.15],
            calf_l: [-0.5, 0, 0],
          },
        };
      }
      default:
        return { drop: 0, pose: {} };
    }
  }

  // ================================================================ büyü hareketleri

  /**
   * t: 0..1 hareket ilerlemesi. side: sağ / sol el sırayla.
   */
  private gesturePose(el: ElementId, slot: AbilitySlot, id: string, t: number, side: number): { pose: Pose; drop: number; spin: number } {
    // Hazırlık (0–0.35) → vuruş (0.35–0.6) → toparlanma
    const wind = Math.min(1, t / 0.35);
    const strike = t < 0.35 ? 0 : Math.min(1, (t - 0.35) / 0.2);
    const out = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const W = ease(wind) * (1 - strike);
    const S = ease(strike) * out;
    const L: BoneName = side > 0 ? 'upperarm_r' : 'upperarm_l';
    const LL: BoneName = side > 0 ? 'lowerarm_r' : 'lowerarm_l';
    const O: BoneName = side > 0 ? 'upperarm_l' : 'upperarm_r';
    const sgn = side > 0 ? 1 : -1;

    if (el === 'earth') {
      if (slot === 'secondary' || id === 'earthWave') {
        // Duvar: çömel, avuçlar aşağı → iki kolla yerden yukarı kaldır
        return {
          drop: 0.2 * W + 0.05 * S,
          spin: 0,
          pose: {
            upperarm_l: [0.4 * W + 2.2 * S, 0, -0.2],
            upperarm_r: [0.4 * W + 2.2 * S, 0, 0.2],
            lowerarm_l: [0.3 + 0.4 * W, 0, 0],
            lowerarm_r: [0.3 + 0.4 * W, 0, 0],
            spine_01: [0.35 * W - 0.15 * S, 0, 0],
            thigh_l: [0.6 * W, 0, -0.3],
            thigh_r: [0.6 * W, 0, 0.3],
            calf_l: [-1.0 * W, 0, 0],
            calf_r: [-1.0 * W, 0, 0],
          },
        };
      }
      if (slot === 'special') {
        // Zırh: yumruklar aşağı, göğüs kabarır, dizler bükük
        return {
          drop: 0.15 * (W + S),
          spin: 0,
          pose: {
            upperarm_l: [0.2, 0, -0.6 * (W + S)],
            upperarm_r: [0.2, 0, 0.6 * (W + S)],
            lowerarm_l: [1.6 * (W + S), 0, 0],
            lowerarm_r: [1.6 * (W + S), 0, 0],
            spine_02: [-0.2 * S, 0, 0],
            thigh_l: [0.5, 0, -0.3],
            thigh_r: [0.5, 0, 0.3],
            calf_l: [-0.9 * (W + S), 0, 0],
            calf_r: [-0.9 * (W + S), 0, 0],
          },
        };
      }
      // Kaya: diz kaldır → yere bas, aynı anda kol öne yumruk
      const knee: BoneName = side > 0 ? 'thigh_r' : 'thigh_l';
      const kneeC: BoneName = side > 0 ? 'calf_r' : 'calf_l';
      return {
        drop: 0.12 * S,
        spin: 0,
        pose: {
          [knee]: [1.3 * W, 0, 0.2 * sgn * S],
          [kneeC]: [-1.4 * W, 0, 0],
          [L]: [0.3 * W + 1.5 * S, -0.2 * sgn * W, 0.1 * sgn],
          [LL]: [1.6 * W + 0.1 * S, 0, 0],
          [O]: [0.6, 0, -0.3 * sgn],
          spine_02: [0.25 * S - 0.1 * W, -0.35 * sgn * W + 0.3 * sgn * S, 0],
        },
      };
    }

    if (el === 'fire') {
      if (slot === 'secondary') {
        // Yıldırım: iki parmak tek kol dümdüz öne, öbür kol geriye
        return {
          drop: 0.05,
          spin: 0,
          pose: {
            upperarm_r: [1.55 * (W + S) + 0.3 * W, 0, 0.05],
            lowerarm_r: [0.6 * W, 0, 0],
            upperarm_l: [-0.5 * S, 0, -0.5 * S],
            spine_02: [0, 0.4 * S, 0],
            thigh_l: [0.4 * S, 0, -0.1],
            calf_l: [-0.5 * S, 0, 0],
          },
        };
      }
      if (slot === 'special') {
        // Nefes: geri çekil, sonra gövdeyi ileri savurarak üfle
        return {
          drop: 0.06,
          spin: 0,
          pose: {
            spine_01: [-0.2 * W + 0.3 * S, 0, 0],
            spine_02: [-0.2 * W + 0.25 * S, 0, 0],
            neck_01: [-0.25 * W + 0.15 * S, 0, 0],
            upperarm_l: [1.2, 0.3, -0.3 - 0.4 * S],
            upperarm_r: [1.2, -0.3, 0.3 + 0.4 * S],
            lowerarm_l: [1.8 - 1.2 * S, 0, 0],
            lowerarm_r: [1.8 - 1.2 * S, 0, 0],
            thigh_l: [0.5 * S, 0, -0.1],
            calf_l: [-0.6 * S, 0, 0],
          },
        };
      }
      // Ateş topu: yumruk + öne hamle (gövde döner, ön diz bükülür)
      return {
        drop: 0.08 * S,
        spin: 0,
        pose: {
          [L]: [0.9 * W + 1.6 * S, 0.1 * sgn * S, 0],
          [LL]: [1.8 * W, 0, 0],
          [O]: [0.8, 0, -0.2 * sgn],
          spine_02: [0.1 * S, (-0.35 * W + 0.55 * S) * sgn, 0],
          pelvis: [0, 0.3 * S * sgn, 0],
          thigh_l: [0.45 * S, 0, -0.1],
          calf_l: [-0.5 * S, 0, 0],
        },
      };
    }

    if (el === 'air') {
      if (slot === 'special') {
        // Rüzgar patlaması: kollar içe kapan → dışa doğru savrul, gövde yukarı açılır
        return {
          drop: 0.12 * W,
          spin: 0,
          pose: {
            upperarm_l: [0.9 * W, 0.6 * W, 0.4 * W - 1.3 * S],
            upperarm_r: [0.9 * W, -0.6 * W, -0.4 * W + 1.3 * S],
            lowerarm_l: [0.8 * W, 0, 0],
            lowerarm_r: [0.8 * W, 0, 0],
            spine_02: [0.3 * W - 0.25 * S, 0, 0],
            thigh_l: [0.4 * W, 0, -0.2],
            thigh_r: [0.4 * W, 0, 0.2],
            calf_l: [-0.7 * W, 0, 0],
            calf_r: [-0.7 * W, 0, 0],
          },
        };
      }
      // Hava topu / küre: dairesel savurma, gövde kol ile birlikte döner
      const arc = t * Math.PI * 1.6;
      return {
        drop: 0.04,
        spin: slot === 'secondary' ? Math.sin(t * Math.PI) * Math.PI * 2 * 0.5 : 0,
        pose: {
          [L]: [1.0 + Math.sin(arc) * 0.6, Math.cos(arc) * 1.0 * sgn, 0.5 * sgn * Math.sin(arc)],
          [LL]: [0.3, 0, 0],
          [O]: [0.9 - Math.sin(arc) * 0.4, -Math.cos(arc) * 0.6 * sgn, -0.4 * sgn],
          spine_02: [0, Math.cos(arc) * 0.45 * sgn, 0],
          spine_01: [0, Math.cos(arc) * 0.25 * sgn, 0],
        },
      };
    }

    // Su
    if (slot === 'special') {
      // Şifa / küre: kollar aşağıdan yukarı daire çizip başın üstünde birleşir
      return {
        drop: 0.06,
        spin: 0,
        pose: {
          upperarm_l: [2.4 * t, 0, -0.9 * Math.sin(t * Math.PI)],
          upperarm_r: [2.4 * t, 0, 0.9 * Math.sin(t * Math.PI)],
          lowerarm_l: [0.4, 0, 0],
          lowerarm_r: [0.4, 0, 0],
          spine_02: [-0.15 * t, 0, 0],
        },
      };
    }
    // Buz / su kamçısı: kol yandan öne dalga gibi süpürür, bilek kıvrılır, gövde dalgalanır
    const wave = Math.sin(t * Math.PI * 2);
    return {
      drop: 0.07,
      spin: 0,
      pose: {
        [L]: [0.6 + 0.9 * S, (0.9 * W - 0.6 * S) * sgn, 0.6 * W * sgn],
        [LL]: [0.9 * W - 0.2 * S + wave * 0.2, 0, 0],
        [side > 0 ? 'hand_r' : 'hand_l']: [wave * 0.6, 0, 0],
        [O]: [0.7, -0.3 * sgn, -0.4 * sgn],
        spine_01: [0, (0.3 * W - 0.35 * S) * sgn, wave * 0.05],
        spine_02: [0.05, (0.2 * W - 0.25 * S) * sgn, 0],
        thigh_l: [0.35, 0, -0.15],
        calf_l: [-0.5, 0, 0],
      },
    };
  }
}
