# Element Arena (Aang)

Üçüncü şahıs, hızlı tempolu element arena dövüş oyunu. Tarayıcıda çalışır (masaüstü + mobil dokunmatik), ileride Capacitor/PWA ile iOS/Android'e paketlenecek.

**Stack:** TypeScript + Three.js + Vite. Kurulum `npm install`, ağır motor yok, anında hot-reload. `vite build` çıktısı (`dist/`) göreli yollarla üretilir ve doğrudan Capacitor'a verilebilir.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5173
npm run dev:lan    # aynı Wi-Fi'deki telefondan test: http://<PC-IP>:5173
npm run build      # typecheck + production build
```

- Masaüstünde dokunmatik arayüzü zorlamak için: `http://localhost:5173/?touch`
- FPS / durum panelini göstermek için: `?debug` (yayında varsayılan olarak gizli)
- Canlı adres: https://aang.dorukplays.com (Cloudflare Pages, `main` dalından otomatik derlenir)
- Konsolda hata ayıklama: `__game.player`, `__game.camera`, `__game.config`

## Kontroller

| Aksiyon | Klavye/Fare | Mobil |
|---|---|---|
| Hareket | WASD / oklar | Sol yarıda dinamik joystick |
| Bakış / nişan | Fare (tıkla → pointer lock) | Sağ yarıda sürükle |
| Zıpla (havada 2. zıplama) | Space | ZIPLA |
| Dash (havada 1 kez) | Shift | DASH |
| Kayma | C | KAY |
| Yeniden doğ | R | ↺ |
| Element seç | 1-4 · Q · fare tekerleği | Üstteki element çipleri |
| Ana / ikincil yetenek | Sol tık (basılı tut = tekrar) / Sağ tık | Büyük / küçük yetenek butonu (aktif yeteneğin ikonu ve adı) |
| Ses aç/kapa | M | Menüdeki ses düğmesi |

## Yetenek sistemi

- `src/abilities/elements.ts`: element listesi (ad, renk)
- `src/abilities/definitions/*.ts`: element başına yetenekler (`primary` / `secondary` slotu, `execute`)
- `src/abilities/AbilitySystem.ts`: aktif element, yetenek başına cooldown, cast süresi, input buffer, dash ile iptal
- Ayarlar: `gameConfig.abilities.tuning.<yetenekId>` → `cooldown`, `castTime`, `castMoveMult`
- Mantık → görsel: `EventBus` olayları (`ability:castStart`, `ability:cast`, `ability:cancel`, `ability:denied`, `element:changed`)

## Savaş altyapısı (Task 3)

- `src/combat/Combatant.ts`: HP, hasar, itme (knockback), ölüm/yeniden doğma; oyuncu + test kuklaları
- `src/combat/ProjectileSystem.ts`: genel mermi sistemi (süpürmeli çarpışma, duvar/karakter isabeti)
- `src/combat/WallSystem.ts`: bükülen yapılar; her sütun gerçek çarpışma kutusu, HP'si var, yükselirken üstündekini kaldırır
- Toprak ayarları: `gameConfig.earth.rock` / `gameConfig.earth.wall`, itme: `gameConfig.combat`

## Su / Buz ve Hava (Task 4)

- **Buz Kıymığı** (Su, sol tık): hızlı, hafif mermi; basılı tut = seri atış
- **Buz Kayması** (Su, sağ tık): düşük sürtünmeli momentumlu süzülme, geniş dönüşler, havada yavaş düşüş, buz izi
- **Şok Dalgası** (Hava, sol tık): koni içindeki rakipleri iter, rakip mermilerini sahibine geri savurur; duvar arkası korunur
- **Rüzgar Sıçrayışı** (Hava, sağ tık): yukarı + ileri fırlatma; ardından zıplamayı basılı tut = yavaş süzül
- Ayarlar: `gameConfig.water` / `gameConfig.air`; hareket modları `PlayerController` (`startGlide`, `launch`)

## Ateş / Yıldırım ve savaş döngüsü (Task 5)

- **Ateş Topu** (Ateş, sol tık): çarpınca patlar — doğrudan hasar + alan hasarı/itme; kendi patlaman seni hasarsız fırlatır (roket zıplaması)
- **Yıldırım Hattı** (Ateş, sağ tık): anlık, delici hat; yoldaki herkese hasar + itme + sersemletme, ilk duvarda durur
- **Can / hasar:** kısa dokunulmazlık, sersemleme, düşük canda artan itme, doğuş koruması (yanıp sönme)
- **Yenilgi:** can 0 → "YENİLDİN", arena dışına düşme → "ARENA DIŞI"; geri sayımla yeniden doğuş; arena dışı eleme son vurana yazılır
- Ayarlar: `gameConfig.fire`, `gameConfig.combat`

## Bot, raund ve menü (Task 6)

- **Ana menü:** bot zorluğu (Kolay / Normal / Zor), "Bota Karşı Maç" veya "Antrenman (Kuklalar)"
- **Maç:** 5 raundun en iyisi (3 galibiyet), 3 sn geri sayım, 90 sn raund süresi (süre dolarsa canı yüksek olan kazanır), raund/maç sonu ekranları, "Tekrar Oyna"
- **Duraklat:** masaüstünde `Esc`, mobilde sağ üstteki `II` → Devam / Yeniden Başlat / Ana Menü
- **Bot** (`src/ai/`): oyuncuyla aynı hareket ve yetenek sistemlerini kullanır — mesafeye göre element seçer, yan adım atar, engelin üstünden zıplar, boşluğa yürümez, canı azalınca siper arar (yoksa toprak duvar diker), kenara itilince merkeze döner (hava zıplaması / dash / rüzgar sıçrayışı), gelen mermiden kaçar
- **Mimari:** tüm oyun mantığı `src/game/GameSession.ts` içinde (DOM/sahne yok); `main.ts` yalnızca input → oturum → render/UI
- **Mobil:** uyarlamalı çözünürlük (FPS düşerse), mobilde azaltılmış efekt parçası, hasar alınca titreşim (Android)
- Ayarlar: `gameConfig.match`, `gameConfig.bot`, `gameConfig.botDifficulty`

## Arena süsleri

- `src/render/ArenaDecor.ts`: düşme çukuru, stadyum duvarı, kademeli tribünler + seyirciler, duvar/sütun bayrakları (element sembolleri), zemindeki renkli bölgeler. Yalnızca görsel, çarpışma yok.
- **Kırılabilen kasalar:** `src/combat/CrateSystem.ts` (gerçek çarpışma kutusu, mermi/yıldırımla kırılır, üst üste kasalar birlikte düşer, raund başında yenilenir). Yerleşim: `arenaLayout.ts` → `crates`, ayar: `gameConfig.crate`.

## Karakter modeli

- `public/models/character.glb` + `animations.glb`: Quaternius **Universal Base Characters** ve **Universal Animation Library** (CC0, `public/models/LICENSE-quaternius.txt`). Dokular 512px WebP, meshopt sıkıştırmalı; parmak kemiği animasyonları atıldı.
- `src/render/CharacterAsset.ts`: yükleme, kıyafet bölgeleri (tunik = takım rengi, kuşak/alın bandı = element rengi), durum → klip eşlemesi (Idle, Jog, Jump, Roll, Crouch, Spell/Punch).
- Dosyalar yoksa ya da yüklenemezse oyun prosedürel karakterle (`PlayerView`) çalışmaya devam eder.
- Yeniden üretmek için: `tools/build-models.mjs` (başındaki açıklamaya bak).

## Vuruş hissi ve efektler

- `src/render/GameFeel.ts`: kamera sarsıntısı (trauma² modeli), isabette kısa vuruş duraksaması (hit-stop), dash sırasında FOV artışı + hız çizgileri. Yalnızca görsel/zamanlama; oyun kurallarına dokunmaz.
- `src/render/EffectsView.ts`: çift zıplama/dash'te element jetleri, mor katmanlı şimşek, hava kalkanı küresi, kıvılcımlar.

## Ses

- `src/audio/SoundSystem.ts`: tamamen Web Audio ile sentezlenir, ses dosyası yok. 8 yeteneğe özel büküm sesleri, çarpma/hasar, kasa/duvar kırılması, patlama, gök gürültüsü, hareket sesleri, geri sayım ve raund sonu.
- Dünya sesleri kameraya göre sağ/sol pan ve uzaklıkla kısılır. Tarayıcı kuralı gereği ses ilk tıklamada açılır.
- `M` tuşu veya menüdeki düğme ile aç/kapa; tercih saklanır.

## Arayüz (HUD)

- `src/ui/MatchHud.ts`: üst ortada kazanılan raund noktaları (●●○ | ○●●), ortada süre (son 10 sn kırmızı), rakip can barı, geri sayım/kazanan duyuruları.
- `src/ui/PlayerStatus.ts`: sol altta dilimli HP barı, hasar vinyeti.
- `src/ui/AbilityBar.ts`: element çipleri + yuvarlak ikonlu yetenek slotları, dairesel bekleme süresi.
- `src/ui/icons.ts`: 8 yetenek + 4 element için satır içi SVG ikonlar; masaüstü slotları ve mobil yetenek butonları aynı seti kullanır.
- Mobilde Dash/Kayma beklemesi doğrudan DASH / KAY butonlarında gösterilir.

**Yeni yetenek/element eklemek:** elements.ts'e element ekle → definitions/ altına dosya ekle → registry'ye kaydet → config'e tuning ekle.

## Mimari

```
src/
  config/     gameConfig.ts (TÜM ayarlar), arenaLayout.ts (arena verisi)
  input/      cihazdan bağımsız aksiyonlar; klavye/fare + dokunmatik kaynakları → InputManager
  physics/    CollisionWorld: AABB + rampa, ışın testi (render'dan bağımsız)
  game/       PlayerController (hareket), ThirdPersonCamera (kamera rig + nişan)
  render/     Three.js sahne, arena ve oyuncu görselleri
  ui/         HUD (DOM)
  main.ts     bootstrap + sabit adımlı (60 Hz) oyun döngüsü, render interpolasyonu
```

Oyun mantığı (`game/`, `physics/`) DOM'a ve sahneye dokunmaz; yalnızca `input/` ve `render/` platforma göre değişir.
