import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Hareket durumu → animasyon klibi adında aranan anahtar kelimeler (sırayla denenir). */
export type AnimKey = 'idle' | 'run' | 'runBack' | 'jump' | 'fall' | 'slide' | 'dash' | 'glide' | 'cast' | 'charge';

const CLIP_HINTS: Record<AnimKey, RegExp[]> = {
  idle: [/^idle(_loop)?$/i, /idle/i],
  run: [/sprint/i, /jog.*f(wd|orward)?/i, /^run/i, /jog/i, /walk/i],
  runBack: [/jog.*b(wd|ack)/i, /walk.*b(wd|ack)/i],
  jump: [/jump.*(start|up)/i, /jump/i],
  fall: [/fall/i, /jump.*(loop|idle)/i, /jump/i],
  slide: [/slide/i, /crouch.*(f|walk)/i, /crouch/i],
  dash: [/roll/i, /dodge/i, /dash/i, /sprint/i],
  glide: [/fall/i, /swim/i, /jump.*(loop|idle)/i],
  cast: [/punch.*(cross|jab|r)/i, /punch/i, /spell.*(shoot|cast)/i, /attack/i, /sword/i],
  charge: [/spell.*(idle|charge|enter)/i, /idle.*(combat|fight)/i, /fight/i, /block/i],
};

export interface CharacterAsset {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Model boyunun oyuncu boyuna ölçek katsayısı */
  scale: number;
}

let pending: Promise<CharacterAsset | null> | null = null;

/**
 * Hazır karakter modelini (public/models/character.glb) ve isteğe bağlı ayrı animasyon
 * dosyasını (public/models/animations.glb) yükler. Dosya yoksa null döner; oyun prosedürel
 * karakterle devam eder.
 */
export function loadCharacterAsset(targetHeight: number): Promise<CharacterAsset | null> {
  if (pending) return pending;
  const base = import.meta.env.BASE_URL ?? './';
  const loader = new GLTFLoader();
  const get = (file: string) => loader.loadAsync(`${base}models/${file}`).catch(() => null);
  pending = Promise.all([get('character.glb'), get('animations.glb')]).then(([model, anims]) => {
    if (!model) return null;
    const clips = [...model.animations, ...(anims?.animations ?? [])];
    const box = new THREE.Box3().setFromObject(model.scene);
    const h = Math.max(0.01, box.max.y - box.min.y);
    model.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
        m.frustumCulled = false; // iskelet animasyonunda sınır kutusu güncellenmez
      }
    });
    return { scene: model.scene, clips, scale: targetHeight / h };
  });
  return pending;
}

/** Bir dövüşçü için modelin bağımsız kopyası + mixer + durum → klip eşlemesi. */
export class CharacterInstance {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly head: THREE.Object3D | null;
  private readonly actions = new Map<AnimKey, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private oneShot: THREE.AnimationAction | null = null;

  constructor(asset: CharacterAsset) {
    this.root = cloneSkinned(asset.scene);
    this.root.scale.setScalar(asset.scale);
    // Model +Z'ye bakar; oyunda ileri -Z
    this.root.rotation.y = Math.PI;
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
        const c = (mat as THREE.MeshStandardMaterial).clone();
        if ('emissive' in c) this.materials.push(c);
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0];
    });
    let head: THREE.Object3D | null = null;
    this.root.traverse((o) => {
      if (!head && (o as THREE.Bone).isBone && /head/i.test(o.name) && !/end|top/i.test(o.name)) head = o;
    });
    this.head = head;
    this.mixer = new THREE.AnimationMixer(this.root);

    const used = new Set<THREE.AnimationClip>();
    for (const key of Object.keys(CLIP_HINTS) as AnimKey[]) {
      const clip = pickClip(asset.clips, CLIP_HINTS[key], used);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (key === 'cast' || key === 'jump' || key === 'dash') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(key, a);
    }
  }

  has(key: AnimKey): boolean {
    return this.actions.has(key);
  }

  /** Sürekli durum animasyonu (koşu, boşta, düşüş...) — yumuşak geçişle. */
  play(key: AnimKey, timeScale = 1): void {
    const a = this.actions.get(key) ?? this.actions.get('idle');
    if (!a) return;
    a.timeScale = timeScale;
    if (a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(0.15).play();
    this.current?.fadeOut(0.15);
    this.current = a;
  }

  /** Tek seferlik hamle (yumruk / büküm), bitince durum animasyonuna döner. */
  playOnce(key: AnimKey, speed = 1.6): void {
    const a = this.actions.get(key);
    if (!a) return;
    this.oneShot?.stop();
    a.reset();
    a.timeScale = speed;
    a.setEffectiveWeight(1).fadeIn(0.05).play();
    this.current?.fadeOut(0.05);
    this.oneShot = a;
  }

  update(dt: number): void {
    if (this.oneShot) {
      const clip = this.oneShot.getClip();
      if (this.oneShot.time >= clip.duration * 0.85 || !this.oneShot.isRunning()) {
        this.oneShot.fadeOut(0.12);
        this.current?.reset().fadeIn(0.12).play();
        this.oneShot = null;
      }
    }
    this.mixer.update(dt);
  }
}

function pickClip(clips: THREE.AnimationClip[], hints: RegExp[], used: Set<THREE.AnimationClip>): THREE.AnimationClip | null {
  for (const re of hints) {
    const c = clips.find((c) => re.test(c.name) && !used.has(c)) ?? clips.find((c) => re.test(c.name));
    if (c) {
      used.add(c);
      return c;
    }
  }
  return null;
}
