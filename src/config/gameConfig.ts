/**
 * TEK AYAR KATMANI
 * Fizik, hız, sürtünme, cooldown, kamera, input ve render değerlerinin tamamı burada.
 * Oyun mantığı bu değerleri doğrudan okur; ince ayar için yalnızca bu dosyayı değiştirin.
 * (İleriki task'larda element / hasar / knockback değerleri de buraya eklenecek.)
 */
export const GameConfig = {
  physics: {
    /** Sabit fizik adımı (Hz). Render FPS'ten bağımsız, deterministik hareket için. */
    fixedHz: 60,
    /** Bir render karesinde en fazla kaç fizik adımı (spiral-of-death koruması). */
    maxStepsPerFrame: 5,
    gravity: 30,
    maxFallSpeed: 40,
    /** Bu yüksekliğin altına düşen karakter arenadan düşmüş sayılır. */
    killY: -20,
  },

  player: {
    radius: 0.4,
    height: 1.8,
    /** Kayma sırasında kapsül yüksekliği. */
    slideHeight: 1.0,
    /** Boy değişimi yumuşatma hızı. */
    heightSharpness: 14,

    runSpeed: 9,
    groundAccel: 80,
    groundDecel: 60,
    /** runSpeed üstündeki hız yerde bu oranla söner (kayma/dash sonrası momentum). */
    overspeedDecel: 22,
    airAccel: 28,
    /** runSpeed üstündeki hız havada bu oranla söner. */
    airDrag: 1.5,

    jumpVelocity: 11,
    airJumpVelocity: 10,
    maxAirJumps: 1,
    /** Zıplama tuşu erken bırakılırsa yükselirken uygulanan ekstra yerçekimi çarpanı. */
    jumpCutGravityMult: 2.2,
    /** Düşerken yerçekimi çarpanı (daha "tok" düşüş). */
    fallGravityMult: 1.35,
    coyoteTime: 0.1,
    jumpBufferTime: 0.12,

    stepHeight: 0.45,
    airStepHeight: 0.2,
    groundSnapDistance: 0.35,
    /** Zemin taramasında kullanılan taban yarıçapı oranı (kenarda durma toleransı). */
    footprintScale: 0.7,
    turnSharpness: 18,
  },

  dash: {
    speed: 26,
    duration: 0.16,
    cooldown: 0.8,
    /** Dash bitince yatay hız bu değere kırpılır. */
    exitSpeed: 12,
    maxAirDashes: 1,
  },

  slide: {
    /** Kaymaya başlamak için gereken minimum yatay hız (altındaysa hareket yönüne runSpeed ile başlar). */
    minStartSpeed: 4,
    boost: 5,
    maxSpeed: 17,
    /** Kayma sürtünmesi (m/s²). Düşük = daha uzun kayma. */
    friction: 7,
    /** Kayma sırasında yön düzeltme hızı (rad/s). */
    steer: 2.5,
    maxDuration: 1.0,
    endSpeed: 4,
    cooldown: 0.35,
  },

  /**
   * Yetenek sistemi. Her yeteneğin ayarı `tuning` altında, yetenek id'si ile.
   * cooldown: yetenek tamamlandıktan sonra bekleme (s)
   * castTime: basıştan etkiye kadar geçen hazırlık süresi (s)
   * castMoveMult: hazırlık sırasında koşu hızı çarpanı
   */
  abilities: {
    /** Element değiştirdikten sonra kısa süre yetenek kullanılamaz (inputBuffer'dan kısa tutun: basış kaybolmaz). */
    switchCooldown: 0.12,
    /** Cooldown/cast bitmeden hemen önce basılan tuş bu süre kadar hatırlanır. */
    inputBuffer: 0.15,
    /** Ana saldırı tuşu basılı tutulursa hazır oldukça tekrar kullanılır. */
    primaryRepeatOnHold: true,
    /** Dash hazırlanan yeteneği iptal eder (cooldown harcanmaz). */
    cancelCastOnDash: true,

    tuning: {
      // Toprak
      earthRock: { cooldown: 0.9, castTime: 0.25, castMoveMult: 0.6 },
      earthWall: { cooldown: 4.0, castTime: 0.35, castMoveMult: 0.3 },
      // Su / Buz
      waterShard: { cooldown: 0.45, castTime: 0.1, castMoveMult: 0.85 },
      iceGlide: { cooldown: 6.0, castTime: 0.15, castMoveMult: 1.0 },
      // Ateş / Yıldırım
      fireBall: { cooldown: 0.6, castTime: 0.15, castMoveMult: 0.8 },
      lightningLine: { cooldown: 3.5, castTime: 0.45, castMoveMult: 0.4 },
      // Hava
      airShockwave: { cooldown: 3.0, castTime: 0.2, castMoveMult: 0.7 },
      airLeap: { cooldown: 5.0, castTime: 0.1, castMoveMult: 1.0 },
    },
  },

  /** Hasar / itme genel ayarları (Task 5'te HP, dokunulmazlık vb. genişleyecek). */
  combat: {
    playerMaxHp: 100,
    /** İtme sonrası kontrol kaybı süresi (s): bu sürede koşu input'u devre dışı, karakter kayar. */
    knockbackControlLoss: 0.35,
    /** İtme sırasında yerdeki kayma sürtünmesi (m/s²). Düşük = daha uzağa savrulur. */
    knockbackGroundFriction: 10,
    dummyMaxHp: 100,
    dummyRespawnDelay: 2.5,
    /** Hasar sonrası kısa dokunulmazlık (s): aynı anda gelen çoklu isabetleri sınırlar. */
    invulnTime: 0.2,
    /** Hasar alınca kısa sersemleme (s): hareket kontrolü yok. */
    hitStun: 0.12,
    /** Doğunca dokunulmazlık (s) — karakter yanıp söner. */
    spawnInvuln: 1.5,
    playerRespawnDelay: 3,
    /** Can azaldıkça itme artar: itme × (1 + eksikCanOranı × bonus). Arena dışına atmayı ödüllendirir. */
    lowHpKnockbackBonus: 0.8,
  },

  /** Ateş / Yıldırım (Task 5) */
  fire: {
    ball: {
      radius: 0.3,
      speed: 34,
      gravity: 1.5,
      damage: 14,
      knockback: 6,
      knockbackUp: 3,
      wallDamage: 20,
      lifetime: 2,
      /** Çarpınca patlama: alan hasarı + itme (merkezden uzaklaştıkça azalır) */
      explosionRadius: 2.4,
      splashDamage: 8,
      splashKnockback: 9,
      splashKnockbackUp: 5,
      /** Kendi patlamanın seni yatay itme oranı (hasar yok) — "roket zıplaması" */
      selfKnockbackMult: 0.8,
      /** Kendi patlamanın seni yukarı fırlatma hızı (m/s) */
      selfLaunchUp: 10,
    },
    lightning: {
      range: 24,
      /** Hattın karakterlere çarpma kalınlığı (gövde yarıçapına eklenir) */
      width: 0.45,
      damage: 22,
      knockback: 7,
      knockbackUp: 2.5,
      wallDamage: 40,
      /** Ek sersemletme süresi (s) */
      stun: 0.35,
    },
  },

  /** Toprak bükme (Task 3) */
  earth: {
    rock: {
      radius: 0.35,
      speed: 40,
      /** Kayanın düşüşü (m/s²); nişan bu düşüşü otomatik telafi eder. */
      gravity: 7,
      damage: 20,
      /** Yatay itme hızı (m/s) */
      knockback: 9,
      /** Dikey itme hızı (m/s) */
      knockbackUp: 4,
      wallDamage: 30,
      lifetime: 2.5,
      /** Yerdeyken kaya karakterin bu kadar önünden, yerden kopar. */
      groundSpawnForward: 0.9,
    },
    wall: {
      /** Duvar = yan yana yükselen bazalt sütunlar */
      columns: 5,
      columnWidth: 0.95,
      /** Sütun aralığı (genişliğin oranı; <1 = üst üste biner, boşluk kalmaz) */
      spacing: 0.88,
      height: 2.6,
      riseTime: 0.22,
      sinkTime: 0.45,
      hp: 150,
      lifetime: 9,
      maxPerCaster: 2,
      minDistance: 2.5,
      maxDistance: 14,
    },
  },

  /** Su / Buz (Task 4) */
  water: {
    shard: {
      radius: 0.18,
      speed: 55,
      gravity: 2,
      damage: 9,
      knockback: 3,
      knockbackUp: 1,
      wallDamage: 8,
      lifetime: 1.2,
    },
    /** Buz Kayması: düşük sürtünmeli, momentumlu süzülme modu */
    glide: {
      duration: 2.6,
      /** Başlarken nişan yönünde en az bu hız verilir. */
      startSpeed: 13,
      maxSpeed: 17,
      /** Yön tuşuna basılıyken hızlanma (m/s²) */
      accel: 10,
      /** Yön tuşu bırakılınca yavaşlama (m/s²). Düşük = buz gibi kayar. */
      friction: 2.5,
      /** Yön değiştirme hızı (rad/s): düşük = geniş, akıcı dönüşler */
      turnRate: 3.0,
      /** Havada düşüş yerçekimi çarpanı (süzülme) */
      airGravityMult: 0.35,
    },
  },

  /** Hava / Rüzgar (Task 4) */
  air: {
    shockwave: {
      range: 7.5,
      coneHalfAngleDeg: 65,
      damage: 6,
      knockback: 18,
      knockbackUp: 7.5,
      /** Koni içindeki rakip mermileri geri yollar; hız çarpanı */
      deflectSpeedMult: 1.15,
      /** Bu mesafeden yakındakiler koni dışında da itilir */
      pointBlank: 1.3,
    },
    leap: {
      upVelocity: 15,
      forwardVelocity: 9,
      /** Sıçrayıştan sonra süzülme süresi: zıplama basılı tutulursa yavaş düşülür */
      floatDuration: 3.0,
      floatFallSpeed: 2.5,
      floatAirAccelMult: 1.6,
    },
  },

  /** Raund / maç (Task 6) */
  match: {
    /** Maçı kazanmak için gereken raund sayısı (3 → 5 raundun en iyisi) */
    roundsToWin: 3,
    countdown: 3,
    /** Raund süresi (s); dolarsa can oranı yüksek olan kazanır */
    roundTime: 90,
    roundEndDelay: 2.5,
  },

  /** Test botu (Task 6). Zorluk çarpanları `botDifficulty` içinde. */
  bot: {
    /** Karar verme aralığı (s) */
    thinkInterval: 0.3,
    preferredRange: 11,
    rangeTolerance: 3,
    /** Can bu oranın altına inince siper arar */
    coverHpThreshold: 0.5,
    coverMinTime: 1.8,
    coverMaxTime: 3.5,
    /** Arena kenarına bu mesafeden yakınsa merkeze döner */
    edgeMargin: 4,
    strafeMinTime: 0.7,
    strafeMaxTime: 1.8,
    elementSwitchMinTime: 3,
    elementSwitchMaxTime: 7,
    /** Mermi hedef önleme oranı (hedefin hızına göre ileri nişan) */
    leadFactor: 0.85,
  },

  botDifficulty: {
    easy: { reactionTime: 0.55, aimErrorDeg: 7, attackChance: 0.55, dodgeChance: 0.05 },
    normal: { reactionTime: 0.32, aimErrorDeg: 3.5, attackChance: 0.8, dodgeChance: 0.12 },
    hard: { reactionTime: 0.18, aimErrorDeg: 1.5, attackChance: 1, dodgeChance: 0.22 },
  },

  camera: {
    fov: 70,
    near: 0.1,
    far: 300,
    distance: 5.5,
    /** Duvara yaslanınca kameranın inebileceği en kısa mesafe (karakter saydamlaşır). */
    minDistance: 0.2,
    pivotHeight: 1.55,
    shoulderOffset: 0.75,
    defaultPitch: 0.25,
    /** Negatif = aşağıdan yukarı bakış. */
    minPitch: -0.55,
    maxPitch: 1.2,
    collisionMargin: 0.25,
    followSharpness: 30,
    verticalFollowSharpness: 14,
    returnSharpness: 6,
    aimMaxDistance: 120,
  },

  input: {
    mouseSensitivity: 0.0022,
    touchLookSensitivity: 0.0065,
    invertY: false,
    /** Sanal joystick yarıçapı (CSS px). */
    joystickRadius: 60,
    joystickDeadzone: 0.12,
    /** Ekranın sol kaçta biri joystick bölgesi. */
    joystickZoneWidth: 0.42,
    /** Tek olayda gelen anormal fare sıçramalarını kırp (bazı tarayıcı pointer-lock hataları). */
    maxMouseDelta: 250,
  },

  /** Kırılabilen tahta kasalar (arena süsü + siper) */
  crate: {
    hp: 40,
    /** Yapı hasarı (wallDamage) bu oranla uygulanır */
    damageMult: 1,
  },

  render: {
    maxPixelRatio: 2,
    mobileMaxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    mobileShadowMapSize: 1024,
    skyColor: 0x9fc4e8,
    fogNear: 45,
    fogFar: 140,
    /** Mobilde efekt parça sayısı çarpanı */
    mobileEffectScale: 0.5,
    /** Uyarlamalı kalite: FPS bu değerin altında kalırsa çözünürlük düşürülür */
    adaptiveMinFps: 45,
    adaptiveMinPixelRatio: 0.75,
  },
};

export type GameConfigType = typeof GameConfig;
