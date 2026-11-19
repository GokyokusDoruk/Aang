/**
 * Tipli, hafif olay yolu. Oyun mantığı olay yayar; render / UI / ses dinler.
 * Böylece mantık katmanı görsel katmanı hiç tanımaz.
 */
export class EventBus<E extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as (payload: never) => void);
    return () => set!.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) (fn as (p: E[K]) => void)(payload);
  }
}
