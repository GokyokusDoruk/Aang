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
| Kayma / eğilme | C (basılı tut = eğik kal, eğikken yürü ve ateş et) | KAY (basılı tut) |
| Yeniden doğ | R | ↺ |
| Element seç | 1-4 · Q · fare tekerleği | Üstteki element çipleri |
| Ana / ikincil yetenek | Sol tık (basılı tut = tekrar) / Sağ tık | Büyük / küçük yetenek butonu (aktif yeteneğin ikonu ve adı) |
| 3. yetenek (Su: Buz Duvarı, Hava: Şok Dalgası) | E | Yetenek butonlarının solundaki 3. buton |
| Ses aç/kapa | M | Menüdeki ses düğmesi |

## Yetenek sistemi

- `src/abilities/elements.ts`: element listesi (ad, renk)
- `src/abilities/definitions/*.ts`: element başına yetenekler (`primary` / `secondary` / `special` slotu, `execute`). `special` (E) slotu boş olan elementlerde arayüzde soluk görünür.
- `src/abilities/AbilitySystem.ts`: aktif element, yetenek başına cooldown, cast süresi, input buffer, dash ile iptal
- Ayarlar: `gameConfig.abilities.tuning.<yetenekId>` → `cooldown`, `castTime`, `castMoveMult`
- Mantık → görsel: `EventBus` olayları (`ability:castStart`, `ability:cast`, `ability:cancel`, `ability:denied`, `element:changed`)

## Kısa / uzun basış

- Her yetenek tuşunun iki kullanımı olabilir: **kısa basış** normal yetenek (bekleme süresi aynı), **basılı tutma** (0.3 sn'den uzun) güçlü versiyon ve kendi uzun bekleme süresi (20 / 30 sn). Uzun basış beklemedeyken tuş kısa basış gibi çalışır.
- Sol tık basınca hemen ateşler, basılı kalırsa uzun basışa geçer. Sağ tık kısa basışta bırakınca çalışır.
- Türler (`ChargedAbility.kind`): `channel` (basılı tuttukça sürer, nişan her an güncel: yönlendirilebilir), `charge` (basılı tuttukça dolar, bırakınca çıkar), `instant` (eşikte bir kez).
- Dash, donma ve raund sonu uzun basışı keser; şarj kesilirse bekleme süresi harcanmaz.
- Arayüz: yetenek dairesinin dışındaki altın halka uzun basışın hazır olduğunu, sağ üstteki sayı kalan saniyeyi gösterir; şarj sırasında ortada "%" çubuğu çıkar. Mobilde aynı halka butonun kenarında.
- Şu an olanlar: **Buz Sarkacı Akımı** (Su sol tık, 3 sn seri buz, 20 sn) **Yıldırım Şarjı** (Ateş sağ tık, 5 sn'ye kadar şarj, tam şarjda 3× hasar, 30 sn) ve **Alev Akımı** (Ateş sol tık, 3 sn yönlendirilebilir alev püskürtme, ~9 m, tutuşturur, 20 sn).
- Ayarlar: `gameConfig.abilities.holdThreshold`, `gameConfig.abilities.charged`, `gameConfig.water.icicle`, `gameConfig.fire.lightning.charged*`

## Savaş altyapısı (Task 3)

- `src/combat/Combatant.ts`: HP, hasar, itme (knockback), ölüm/yeniden doğma; oyuncu + test kuklaları
- `src/combat/ProjectileSystem.ts`: genel mermi sistemi (süpürmeli çarpışma, duvar/karakter isabeti)
- `src/combat/WallSystem.ts`: bükülen yapılar; her sütun gerçek çarpışma kutusu, HP'si var, yükselirken üstündekini kaldırır
- Toprak ayarları: `gameConfig.earth.rock` / `gameConfig.earth.wall`, itme: `gameConfig.combat`

## Su / Buz ve Hava (Task 4)

- **Buz Kıymığı** (Su, sol tık): hızlı, hafif mermi; basılı tut = seri atış. Her isabet 1 **üşüme** yığını ekler (yığın başına %15 yavaşlama, 2.2 sn sonra söner); 3 yığında hedef 0.7 sn **donar** (hareket ve yetenek yok). Üşüyen karakter maviye döner; oyuncunun HP barının yanında ❄ ●●○ göstergesi çıkar.
- **Buz Duvarı** (Su, E): hemen önünde anında (0.1 sn) yükselen buz siperi. Toprak duvardan hızlı ama kırılgan (90 HP, 5 sn); aynı anda 1 tane. Kırılınca parçaları 3.2 m içindeki rakiplere 1 üşüme yığını ekler. Ayar: `gameConfig.water.iceWall`.
- **Buz Yolu** (Su, sağ tık): ayağının altında buzdan yol yaratıp üstünde kayarsın. Yukarı bakınca yol rampa gibi yükselir, aşağı bakınca alçalır, düz bakınca yükseklik korunur; Space basılıyken tırmanır. Plakalar 5 sn üstünde durulabilir (rakipler de), sonra erir. Kayma havada biterse altında bir platform oluşur; eriyince düşersin. Güçlü bir itme seni yoldan düşürür.
- **Kar Yolu** (Su, sağ tık basılı tut, 30 sn): aynı yol, ama kar izi bırakır; üstüne/yanına gelen rakipler yarım saniyede bir 2 hasar alır ve üşür.
- **Kaya Fırlatma** (Toprak, sol tık): zemine çarptığı yerde 5 sn duran, sonra geri inen toprak tepeciği yükseltir (rakibe çarparsa yükseltmez). Kendi toprak duvarına 3.5 m yakınken sol tık: duvar kopar ve nişana fırlar (kayanın 2 katı hasar). Ayar: `gameConfig.earth.bump`, `earth.wallThrow`.
- **Dev Kaya** (Toprak, sol tık basılı tut, 20 sn): başının üstünde 1 sn'de dolan dev kaya; bırakınca fırlar, büyük patlama + etrafa saçılan kaya parçaları. Ayar: `earth.boulder`, `earth.debris`.
- **Duvar Dizisi** (Toprak, sağ tık basılı tut, 30 sn): senden nişana doğru saniyede bir yükselen duvarlar. Değdiği rakibi 12 hasarla havaya atar; rakip süzülerek düşer ve yere düşünce 1 sn yerde kalır (hareket ve yetenek yok). Ayar: `earth.wave`.
- **Hava Topu** (Hava, sol tık): çarptığı yerde küçük fırtına; az hasar (4), çarpma noktasından güçlü savurma. Yakında patlarsa seni de hasarsız fırlatır. Ayar: `gameConfig.air.ball`
- **Hortum** (Hava, sol tık basılı tut, 20 sn): 4 sn'ye kadar nişanını izleyen hortum; içindekileri dışa ve yukarı savurur, girdapla döndürür, az hasar verir. Bırakınca söner. Ayar: `air.tornado`
- **Rüzgar Küresi** (Hava, sağ tık): küre içinde baktığın yöne (yukarı / aşağı dahil, A/D ile yana) 1.5 sn hızlı uçuş (koşu hızının 1.5 katı); hep hareket eder. Bitince zıplamayı basılı tut = süzül. Ayar: `air.sphere`
- **Dev Küre** (Hava, sağ tık basılı tut, 30 sn): iki kat büyük küre; değdiği rakibe 10 hasar ve güçlü itme
- **Şok Dalgası** (Hava, E): koni içindeki rakipleri iter, rakip mermilerini sahibine geri savurur; duvar arkası korunur
- Ayarlar: `gameConfig.water` (üşüme: `gameConfig.water.chill`) / `gameConfig.air`; hareket modları `PlayerController` (`startGlide`, `launch`)

## Ateş / Yıldırım ve savaş döngüsü (Task 5)

- **Ateş Topu** (Ateş, sol tık): çarpınca patlar — doğrudan hasar + alan hasarı/itme; %50 ihtimalle tutuşturur (3 sn × 1 hasar); kendi patlaman seni fırlatır (roket zıplaması) ve alan hasarının %25'ini sana verir. Buz/üşüme yanmayı söndürür
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
- **Bot gücü:** `gameConfig.bot.power` (şu an 0.8 = her seviyede %20 zayıf). Hareket hızı, ateş sıklığı, isabet (sapma + önleme), tepki/karar hızı ve kaçınma bu tek sayıyla ölçeklenir.

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
