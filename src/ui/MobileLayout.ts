/**
 * Mobil yerleşim ölçüleri: ekran boyutuna göre dokunmatik arayüz ölçeği ve çentik / kavisli kenar
 * güvenli alanları. Değerler CSS değişkeni olarak da yazılır (--ui-scale, --vw-px, --vh-px).
 *
 * Yalnızca dokunmatik arayüz ve dar ekran kuralları bu değerleri kullanır; masaüstü görünümü etkilenmez.
 */
export const mobileMetrics = {
  /** Dokunmatik buton / joystick ölçeği (küçük telefon 0.84 … tablet / katlanabilir 1.3) */
  scale: 1,
  /** Güvenli alan (px): env(safe-area-inset-*) değerlerinin ölçülmüş hâli */
  inset: { top: 0, right: 0, bottom: 0, left: 0 },
  portrait: false,
};

const listeners = new Set<() => void>();
let probe: HTMLDivElement | null = null;

/** Ölçüler değişince (döndürme, adres çubuğu, pencere boyutu) çağrılır. */
export function onMobileLayout(fn: () => void): void {
  listeners.add(fn);
}

function measure(): void {
  // env() değerleri JS'ten doğrudan okunamaz: görünmez bir ölçüm kutusunun padding'ine yazdırılır
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;inset:0;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  mobileMetrics.inset.top = parseFloat(cs.paddingTop) || 0;
  mobileMetrics.inset.right = parseFloat(cs.paddingRight) || 0;
  mobileMetrics.inset.bottom = parseFloat(cs.paddingBottom) || 0;
  mobileMetrics.inset.left = parseFloat(cs.paddingLeft) || 0;

  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  mobileMetrics.portrait = h > w;
  // 390 px (yaygın telefon kısa kenarı) = 1. Çok küçükte de butonlar 44 px altına inmesin diye alt sınır 0.84.
  mobileMetrics.scale = Math.max(0.84, Math.min(1.3, Math.min(w, h) / 390));

  const root = document.documentElement.style;
  root.setProperty('--ui-scale', mobileMetrics.scale.toFixed(3));
  root.setProperty('--vw-px', `${w}px`);
  root.setProperty('--vh-px', `${h}px`);
  for (const fn of listeners) fn();
}

let started = false;
export function initMobileLayout(): void {
  if (started) return;
  started = true;
  measure();
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
  };
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  // Bazı tarayıcılar döndürmeden sonra boyutu gecikmeli bildirir
  window.addEventListener('orientationchange', () => setTimeout(measure, 200));
}
