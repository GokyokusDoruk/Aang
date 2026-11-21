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

    // Zıplama yüksekliği hızın karesiyle büyür: ×√1.1 ≈ %10 daha yüksek
    jumpVelocity: 11.54,
    airJumpVelocity: 10.49,
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
    /** C basılı tutulurken eğik yürüme hızı çarpanı */
    crouchSpeedMult: 0.45,
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
    /** Tuş bu süreden uzun basılı kalırsa yeteneğin uzun basış versiyonu çalışır (s) */
    holdThreshold: 0.3,

    /** Uzun basış versiyonları: bekleme (s), hareket çarpanı, süre */
    charged: {
      /** Su sol tık uzun: yönlendirilebilir seri buz sarkacı akımı */
      icicleStream: { cooldown: 20, moveMult: 0.6, maxDuration: 3, tickInterval: 0.09 },
      /** Ateş sağ tık uzun: 5 sn'ye kadar şarj, bırakınca güçlü yıldırım */
      lightningCharged: { cooldown: 30, moveMult: 0.4, maxDuration: 5 },
      /** Ateş sol tık uzun: yönlendirilebilir alev püskürtme */
      flameStream: { cooldown: 20, moveMult: 0.55, maxDuration: 3, tickInterval: 0.06 },
      /** Su sağ tık uzun: kar izi bırakan buz yolu */
      snowRide: { cooldown: 30, moveMult: 1, maxDuration: 0 },
      /** Toprak sol tık uzun: başının üstünde büyüyen dev kaya, bırakınca fırlar (şarj 1 sn) */
      boulder: { cooldown: 20, moveMult: 0.5, maxDuration: 1 },
      /** Toprak sağ tık uzun: nişana doğru sırayla yükselen duvarlar */
      earthWave: { cooldown: 30, moveMult: 1, maxDuration: 0 },
      /** Hava sol tık uzun: yönlendirilebilir hortum */
      tornado: { cooldown: 20, moveMult: 0.5, maxDuration: 4, tickInterval: 1 / 30 },
      /** Hava sağ tık uzun: iki kat büyük, çarpan rüzgar küresi */
      bigSphere: { cooldown: 30, moveMult: 1, maxDuration: 0 },
    },

    tuning: {
      // Toprak
      earthRock: { cooldown: 0.9, castTime: 0.25, castMoveMult: 0.6 },
      earthWall: { cooldown: 4.0, castTime: 0.35, castMoveMult: 0.3 },
      // Su / Buz
      waterShard: { cooldown: 0.45, castTime: 0.1, castMoveMult: 0.85 },
      iceGlide: { cooldown: 6.0, castTime: 0.15, castMoveMult: 1.0 },
      iceWall: { cooldown: 7.0, castTime: 0.1, castMoveMult: 0.5 },
      // Ateş / Yıldırım
      fireBall: { cooldown: 0.6, castTime: 0.15, castMoveMult: 0.8 },
      lightningLine: { cooldown: 3.5, castTime: 0.45, castMoveMult: 0.4 },
      // Hava
      airBall: { cooldown: 0.8, castTime: 0.12, castMoveMult: 0.8 },
      airSphere: { cooldown: 4.0, castTime: 0.05, castMoveMult: 1.0 },
      /** E: Şok Dalgası (rakipleri iter, mermileri geri savurur) */
      airShockwave: { cooldown: 5.0, castTime: 0.2, castMoveMult: 0.7 },
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
      /** Kendi patlamanın sana verdiği hasar oranı (alan hasarına göre) */
      selfDamageMult: 0.25,
      /** İsabet / patlamada yanma ihtimali */
      burnChance: 0.5,
    },
    /** Yanma: süre boyunca her saniye küçük hasar (yeniden yanınca süre yenilenir) */
    burn: {
      ticks: 3,
      interval: 1,
      damagePerTick: 1,
    },
    /** Alev akımı (Ateş sol tık uzun basış): kısa menzilli, geniş, yükselen alev dilleri */
    flame: {
      radius: 0.38,
      speed: 21,
      /** Negatif: alev hafifçe yükselir */
      gravity: -2,
      damage: 2,
      knockback: 1.4,
      knockbackUp: 0.4,
      wallDamage: 2,
      /** ~9 m menzil */
      lifetime: 0.45,
      burnChance: 0.3,
      /** Nişandan rastgele sapma (derece) */
      spreadDeg: 5,
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
      /** Tam şarjda çarpanlar (şarj oranıyla doğrusal artar) */
      chargedDamageMult: 3,
      chargedKnockbackMult: 2.5,
      chargedStunBonus: 0.8,
      chargedWidthMult: 1.7,
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
      /** Zemine çarpınca orada toprak tepeciği yükselir */
      bumpOnImpact: true,
    },
    /** Kaya zemine çarpınca yükselen tepecik: 5 sn durur, sonra geri iner. Üstünde durulabilir. */
    bump: {
      columns: 5,
      columnWidth: 0.85,
      spacing: 0.7,
      height: 0.85,
      riseTime: 0.15,
      sinkTime: 0.8,
      hp: 60,
      lifetime: 5,
      maxPerCaster: 6,
      minDistance: 0,
      maxDistance: 0,
    },
    /** Dev kaya (sol tık uzun basış): yavaş, ağır, büyük patlama + etrafa saçılan kaya parçaları */
    boulder: {
      radius: 0.85,
      speed: 30,
      gravity: 8,
      damage: 30,
      knockback: 12,
      knockbackUp: 6,
      wallDamage: 80,
      lifetime: 3,
      explosionRadius: 3.6,
      splashDamage: 14,
      splashKnockback: 10,
      splashKnockbackUp: 6,
      bumpOnImpact: true,
      /** Patlamada saçılan parça sayısı */
      fragments: 9,
      /** Şarj 0'da güç oranı (tam şarjda 1) */
      minChargePower: 0.6,
      /** Başının bu kadar üstünde oluşur (m) */
      spawnHeight: 2.6,
    },
    /** Dev kayadan saçılan parça */
    debris: {
      radius: 0.2,
      speed: 15,
      gravity: 18,
      damage: 7,
      knockback: 3,
      knockbackUp: 2,
      wallDamage: 5,
      lifetime: 1.2,
    },
    /** Kendi duvarının yanında sol tık: duvar kopup nişana fırlar (kayanın 2 katı hasar) */
    wallThrow: {
      /** Duvarın en yakın sütununa bu kadar yakınsan (m) duvarı fırlatırsın */
      grabRange: 3.5,
      radius: 0.8,
      speed: 32,
      gravity: 7,
      damage: 40,
      knockback: 18,
      knockbackUp: 8,
      wallDamage: 60,
      lifetime: 2.5,
      explosionRadius: 2.4,
      splashDamage: 10,
      splashKnockback: 9,
      splashKnockbackUp: 5,
      bumpOnImpact: true,
    },
    /** Duvar dizisi (sağ tık uzun basış): nişana doğru sırayla yükselen duvarlar, isabet edeni havaya atar */
    wave: {
      /** Ardışık duvarlar arası mesafe (m) */
      step: 2.6,
      /** Duvarlar arası süre (s) */
      interval: 1,
      minSteps: 2,
      maxSteps: 6,
      damage: 12,
      /** Havaya fırlatma hızı (m/s) */
      launchUp: 13,
      /** Havadayken yerçekimi çarpanı (süzülür) */
      floatGravityMult: 0.5,
      /** Yere düşünce sersemleme (s) */
      downTime: 1,
      /** Duvarın önü/arkası isabet payı (m) */
      hitDepth: 1.1,
      wall: {
        columns: 3,
        columnWidth: 0.95,
        spacing: 0.88,
        height: 2.2,
        riseTime: 0.12,
        sinkTime: 0.35,
        hp: 80,
        lifetime: 1.6,
        maxPerCaster: 8,
        minDistance: 0,
        maxDistance: 0,
      },
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
      /** İsabette eklenen üşüme yığını */
      chill: 1,
    },
    /** Buz sarkacı (Su sol tık uzun basış): küçük, hızlı, az hasarlı, üşütür */
    icicle: {
      radius: 0.12,
      speed: 62,
      gravity: 1,
      damage: 3,
      knockback: 0.6,
      knockbackUp: 0.2,
      wallDamage: 3,
      lifetime: 1,
      /** Kısmi üşüme: birkaç isabette bir yığın */
      chill: 0.35,
      /** Nişandan rastgele sapma (derece) */
      spreadDeg: 2.2,
    },
    /** Üşüme: her yığın koşu hızını düşürür; tam yığında kısa süre donar. */
    chill: {
      maxStacks: 3,
      /** Yığın başına hız kaybı (0.15 = %15) */
      slowPerStack: 0.15,
      /** Son isabetten bu kadar sonra yığınlar sıfırlanır (s) */
      duration: 2.2,
      /** Tam yığında donma süresi (s); sonra yığınlar sıfırlanır */
      freezeTime: 0.7,
    },
    /**
     * Buz Duvarı (E): hemen önünde anında yükselen, toprak duvardan hızlı ama kırılgan siper.
     * Kırılınca parçalanır ve yakındaki rakipleri üşütür.
     */
    iceWall: {
      columns: 6,
      columnWidth: 0.8,
      spacing: 0.85,
      height: 2.3,
      riseTime: 0.12,
      sinkTime: 0.3,
      hp: 90,
      lifetime: 5,
      maxPerCaster: 1,
      /** Nişandan bağımsız: karakterin bu kadar önüne konur */
      minDistance: 2.2,
      maxDistance: 2.2,
      /** Kırılınca bu yarıçaptaki rakiplere eklenen üşüme */
      shatterRadius: 3.2,
      shatterChill: 1,
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
      /**
       * Buz yolu: kayarken yükseklik nişanı izler (yukarı bak = rampa gibi tırman).
       * Bu açının altındaki nişan düz sayılır (yükseklik korunur).
       */
      pitchDeadzoneDeg: 6,
      maxPitchDeg: 40,
      minPitchDeg: -35,
      /** Dikey hız sınırları (m/s) */
      maxClimb: 7.5,
      maxDescend: 10,
      /** Zıplama basılıyken en az bu hızla yüksel (m/s) */
      jumpRiseSpeed: 6,
      /** Bu güçte (m/s) bir itme yersen buz yolundan düşersin */
      knockOffImpulse: 4,
    },
    /** Kayarken ayağın altında oluşan, sonra eriyen buz yolu */
    icePath: {
      /** İki plaka arası mesafe (m) */
      spacing: 0.6,
      width: 1.5,
      thickness: 0.28,
      /** Plakanın ömrü (s); son meltTime saniyesinde erir */
      lifetime: 5,
      meltTime: 1,
      /** Kuran oyuncu geçip gitsin diye çarpışma bu kadar sonra devreye girer (s) */
      armDelay: 0.3,
      /** Kayma havada biterse altında oluşan platformun kenarı (m) */
      endPlatform: 2.4,
      maxSegments: 220,
      /** Kar izi (uzun basış) */
      snowRadius: 1.4,
      snowHeight: 1.8,
      snowTick: 0.5,
      snowDamage: 2,
      snowChill: 0.5,
      /** Kar izi plakası başına saniyede yağan kar tanesi */
      snowfallRate: 75,
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
    /** Hava topu (sol tık): çarptığı yerde küçük fırtına; az hasar, çarpma noktasından güçlü savurma */
    ball: {
      radius: 0.32,
      speed: 38,
      gravity: 0.5,
      damage: 4,
      knockback: 22,
      knockbackUp: 9,
      wallDamage: 6,
      lifetime: 1.6,
      explosionRadius: 3.2,
      splashDamage: 3,
      splashKnockback: 22,
      splashKnockbackUp: 9,
      /** Kendi fırtınan seni de savurur (hasarsız) */
      selfKnockbackMult: 0.7,
      selfLaunchUp: 9,
    },
    /** Hortum (sol tık uzun basış): nişanı izleyen, içindekileri savuran girdap */
    tornado: {
      speed: 9,
      radius: 1.9,
      height: 4,
      damage: 3,
      /** Aynı rakibe vurma aralığı (s) */
      hitInterval: 0.35,
      /** Dışa itme, girdap (teğetsel) ve kaldırma hızları (m/s) */
      push: 9,
      swirl: 5,
      lift: 6,
      spawnDistance: 2.5,
      maxLifetime: 6,
      /** Bırakınca sönme süresi (s) */
      fadeTime: 0.5,
    },
    /** Rüzgar küresi (sağ tık): her yöne hızlı, kısa uçuş; hep hareket eder */
    sphere: {
      duration: 1.5,
      /** Koşu hızına göre çarpan (+%50) */
      speedMult: 1.5,
      /** Nişanın yukarı / aşağı açısı sınırı (derece) */
      maxPitchDeg: 60,
      /** Kürenin yarıçapı (görsel ve çarpma) */
      radius: 1.1,
      /** Uzun basış: küre bu kat büyük ve çarpar */
      bigScale: 2,
      ramDamage: 10,
      ramKnockback: 16,
      ramKnockbackUp: 6,
      /** Bu güçte bir itme uçuşu bozar */
      knockOffImpulse: 6,
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
    /**
     * Botun genel gücü (1 = zorluk tablosundaki değerler). 0.8 = her seviyede %20 zayıf:
     * hareket hızı, saldırı sıklığı, isabet (sapma + önleme), tepki ve karar hızı, kaçınma.
     */
    power: 0.8,
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
