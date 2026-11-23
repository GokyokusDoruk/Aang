import type { Vector3 } from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { GameServices } from '../game/GameServices';
import type { PlayerController } from '../game/PlayerController';
import type { CollisionWorld } from '../physics/CollisionWorld';
import type { ElementId } from './elements';

export type { GameEvents } from '../core/GameEvents';

export type AbilitySlot = 'primary' | 'secondary' | 'special';

export const ABILITY_SLOTS: readonly AbilitySlot[] = ['primary', 'secondary', 'special'];

export interface AbilityTuning {
  cooldown: number;
  castTime: number;
  castMoveMult: number;
}

/**
 * Yeteneği kullanan varlık. Oyuncu ve (Task 6) bot aynı arayüzü uygular,
 * böylece AbilitySystem kimin kullandığını bilmez.
 */
export interface AbilityCaster {
  readonly id: string;
  /** Ayak tabanı */
  readonly position: Vector3;
  readonly grounded: boolean;
  /** Hareket gövdesi: hareket yetenekleri (kayma, sıçrayış) bunu kullanır. */
  readonly controller: PlayerController;
  /** Yeteneğin çıkış noktası, yönü (normalize) ve hedef noktası. */
  getAim(outOrigin: Vector3, outDirection: Vector3, outTarget: Vector3): void;
}

export interface AbilityContext {
  caster: AbilityCaster;
  origin: Vector3;
  direction: Vector3;
  target: Vector3;
  world: CollisionWorld;
  bus: EventBus<GameEvents>;
  services: GameServices;
}

/**
 * Uzun basış (basılı tutma) versiyonu. Kısa basış normal yeteneği kullanır;
 * tuş `GameConfig.abilities.holdThreshold` kadar basılı kalırsa bu çalışır ve kendi
 * (uzun) bekleme süresine girer. Normal yeteneğin bekleme süresi bundan etkilenmez.
 * - channel: basılı tutuldukça (en fazla maxDuration) her tickInterval'de `tick`; nişan her adımda güncel (yönlendirilebilir)
 * - charge: basılı tutuldukça 0..1 dolar (maxDuration'da tam); bırakınca `release(ctx, şarj)`
 * - instant: eşik aşılınca bir kez `release(ctx, 1)`
 */
export interface ChargedAbility {
  id: string;
  name: string;
  kind: 'channel' | 'charge' | 'instant';
  /** Uzun basış kullanıldıktan sonraki bekleme (s) */
  cooldown: number;
  /** Kanal / şarj sırasında koşu hızı çarpanı */
  moveMult: number;
  /** channel: en uzun süre; charge: tam dolma süresi */
  maxDuration: number;
  /** channel: kaç saniyede bir tick */
  tickInterval?: number;
  start?(ctx: AbilityContext): void;
  tick?(ctx: AbilityContext, elapsed: number): void;
  end?(ctx: AbilityContext): void;
  release?(ctx: AbilityContext, charge: number): boolean | void;
  /** true döndükçe (örn. uçuş sürerken) bu uzun basışın bekleme süresi işlemez: süre etki bitince başlar */
  activeWhile?(caster: AbilityCaster): boolean;
}

export interface AbilityDef {
  id: string;
  element: ElementId;
  slot: AbilitySlot;
  name: string;
  description: string;
  /** gameConfig'teki nesneye referans: ayar değişikliği anında yansır. */
  tuning: AbilityTuning;
  /**
   * Cast tamamlandığında çalışır. `false` dönerse yetenek geçersiz sayılır
   * (örn. duvar boşluğa konamaz): cooldown harcanmaz, 'ability:denied' yayılır.
   * Tanımlı değilse yer tutucu efekt gösterilir.
   */
  execute?(ctx: AbilityContext): boolean | void;
  /** Uzun basış versiyonu (isteğe bağlı) */
  charged?: ChargedAbility;
  /** true döndükçe (örn. uçuş sürerken) bekleme süresi işlemez: süre etki bitince başlar */
  activeWhile?(caster: AbilityCaster): boolean;
  /**
   * Etki sürerken aynı tuşa yeniden basılınca çağrılır; true dönerse etki durdurulmuştur
   * ve bu basış yeni bir kullanım sayılmaz.
   */
  stopActive?(caster: AbilityCaster): boolean;
}
