// Голландский аукцион: цена снижается ступенями от старта до минимума.
// Эта же формула продублирована в public/index.html — меняйте обе вместе.
export const HOLD_MS = 2 * 60 * 1000; // сколько минут цена закреплена за покупателем, пока он заполняет форму
const ROUND = 10000;

// Учитывает истёкшую бронь: время брони не съедает время аукциона.
export function norm(lot, now) {
  const l = { ...lot, paused: lot.paused || 0 };
  if (l.hold && l.hold.until <= now) {
    l.paused += l.hold.until - l.hold.since;
    l.hold = null;
  }
  return l;
}

export function priceAt(lot, now) {
  const stepMs = lot.stepMin * 60000;
  const durMs = lot.durationMin * 60000;
  const n = Math.max(2, Math.floor(durMs / stepMs));
  const holdActive = !!(lot.hold && lot.hold.until > now);
  const effNow = holdActive ? lot.hold.since : now;
  const elapsed = effNow - lot.startAt - (lot.paused || 0);
  if (lot.status === 'sold') return { phase: 'sold', price: lot.sold?.price || lot.min };
  if (lot.status === 'cancelled') return { phase: 'cancelled', price: lot.min };
  if (elapsed < 0) return { phase: 'scheduled', price: lot.start, startsAt: lot.startAt + (lot.paused || 0) };
  if (elapsed >= durMs && !holdActive) return { phase: 'ended', price: lot.min };
  const steps = Math.min(n - 1, Math.floor(elapsed / stepMs));
  const raw = lot.start - ((lot.start - lot.min) * steps) / (n - 1);
  const price = steps === 0 ? lot.start : steps >= n - 1 ? lot.min : Math.max(lot.min, Math.round(raw / ROUND) * ROUND);
  const base = lot.startAt + (lot.paused || 0);
  return {
    phase: holdActive ? 'held' : 'live',
    price,
    nextDropAt: steps < n - 1 ? base + (steps + 1) * stepMs : null,
    endAt: base + durMs,
  };
}
