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

  render: {
    maxPixelRatio: 2,
    mobileMaxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    mobileShadowMapSize: 1024,
    skyColor: 0x9fc4e8,
    fogNear: 45,
    fogFar: 140,
  },
};

export type GameConfigType = typeof GameConfig;
