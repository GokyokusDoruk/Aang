import { ELEMENTS, ELEMENT_ORDER, type ElementId } from '../abilities/elements';
import type { AbilitySystem } from '../abilities/AbilitySystem';
import type { AbilitySlot } from '../abilities/types';

const SLOT_KEYS: Record<AbilitySlot, string> = { primary: 'Sol tık', secondary: 'Sağ tık' };

/**
 * Element seçici + aktif yetenek slotları + hazırlık (cast) çubuğu.
 * - Masaüstü: alt ortada; slotlarda dairesel cooldown ve kalan süre
 * - Mobil: element çipleri üstte (dokunarak seçilir); slot durumları dokunmatik butonlarda
 */
export class AbilityBar {
  private readonly root: HTMLDivElement;
  private readonly chips = new Map<ElementId, HTMLElement>();
  private readonly slots = new Map<AbilitySlot, { el: HTMLElement; name: HTMLElement; cd: HTMLElement }>();
  private readonly castBar: HTMLDivElement;
  private readonly castFill: HTMLDivElement;
  private readonly castName: HTMLSpanElement;
  private shownElement: ElementId | null = null;
  private readonly cdText = new Map<AbilitySlot, string>();

  constructor(container: HTMLElement, opts: { touch: boolean; onSelectElement: (e: ElementId) => void }) {
    this.root = document.createElement('div');
    this.root.className = `ability-bar${opts.touch ? ' touch' : ''}`;

    if (!opts.touch) {
      const slotRow = document.createElement('div');
      slotRow.className = 'slots';
      for (const slot of ['primary', 'secondary'] as AbilitySlot[]) {
        const el = document.createElement('div');
        el.className = 'slot';
        el.innerHTML = `<div class="sweep"></div><span class="key">${SLOT_KEYS[slot]}</span><span class="name"></span><span class="cd"></span>`;
        slotRow.appendChild(el);
        this.slots.set(slot, { el, name: el.querySelector('.name')!, cd: el.querySelector('.cd')! });
      }
      this.root.appendChild(slotRow);
    }

    const chipRow = document.createElement('div');
    chipRow.className = 'chips';
    ELEMENT_ORDER.forEach((id, i) => {
      const meta = ELEMENTS[id];
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.style.setProperty('--c', meta.css);
      chip.innerHTML = `<span class="num">${i + 1}</span><span class="nm">${meta.short}</span>`;
      chip.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        opts.onSelectElement(id);
      });
      chipRow.appendChild(chip);
      this.chips.set(id, chip);
    });
    this.root.appendChild(chipRow);
    container.appendChild(this.root);

    this.castBar = document.createElement('div');
    this.castBar.className = 'cast-bar hidden';
    this.castFill = document.createElement('div');
    this.castFill.className = 'fill';
    this.castName = document.createElement('span');
    this.castBar.append(this.castFill, this.castName);
    container.appendChild(this.castBar);
  }

  update(sys: AbilitySystem): void {
    if (sys.activeElement !== this.shownElement) {
      this.shownElement = sys.activeElement;
      for (const [id, chip] of this.chips) chip.classList.toggle('active', id === sys.activeElement);
      this.root.style.setProperty('--c', ELEMENTS[sys.activeElement].css);
      for (const [slot, s] of this.slots) s.name.textContent = sys.slot(slot)?.name ?? '—';
    }

    for (const [slot, s] of this.slots) {
      const def = sys.slot(slot);
      const ratio = def ? sys.cooldownRatio(def) : 0;
      s.el.style.setProperty('--cd', ratio.toFixed(3));
      s.el.classList.toggle('ready', ratio <= 0 && !sys.switching);
      const remaining = def ? sys.cooldownRemaining(def) : 0;
      const text = remaining > 0 ? remaining.toFixed(remaining < 1 ? 1 : 0) : '';
      if (this.cdText.get(slot) !== text) {
        this.cdText.set(slot, text);
        s.cd.textContent = text;
      }
    }

    const casting = sys.castingAbility;
    this.castBar.classList.toggle('hidden', !casting);
    if (casting) {
      this.castFill.style.width = `${(sys.castProgress * 100).toFixed(1)}%`;
      if (this.castName.textContent !== casting.name) this.castName.textContent = casting.name;
      this.castBar.style.setProperty('--c', ELEMENTS[casting.element].css);
    }
  }

  flashDenied(slot: AbilitySlot): void {
    const s = this.slots.get(slot);
    if (!s) return;
    s.el.classList.remove('denied');
    void s.el.offsetWidth;
    s.el.classList.add('denied');
  }
}
