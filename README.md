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
