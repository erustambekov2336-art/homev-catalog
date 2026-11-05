// Голландский аукцион: цена снижается каждую секунду от старта до минимума с точностью до 1 сума.
// Шаг в секунду считается сам: (старт − минимум) / (90% длительности в секундах).
// Эта же формула продублирована в public/index.html — меняйте обе вместе.
export const HOLD_MS = 2 * 60 * 1000; // сколько цена закреплена за покупателем, пока он заполняет форму
export const DECLINE_SHARE = 0.9;     // цена падает 90% времени лота, последние 10% — по минимальной цене
const ROUND = 1;                      // точность цены: 1 сум — цифры «бегут» каждую секунду
export const HOLD_LIMIT = 10;         // сколько раз можно нажать «Купить» на одном лоте…
export const HOLD_WINDOW_MS = 10 * 60 * 1000; // …за это время (10 минут)

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
  const durMs = lot.durationMin * 60000;
  const declineMs = durMs * DECLINE_SHARE;
  const holdActive = !!(lot.hold && lot.hold.until > now);
  const effNow = holdActive ? lot.hold.since : now;
  const elapsed = effNow - lot.startAt - (lot.paused || 0);
  if (lot.status === 'sold') return { phase: 'sold', price: lot.sold?.price || lot.min };
  if (lot.status === 'cancelled') return { phase: 'cancelled', price: lot.min };
  if (elapsed < 0) return { phase: 'scheduled', price: lot.start, startsAt: lot.startAt + (lot.paused || 0) };
  if (elapsed >= durMs && !holdActive) return { phase: 'ended', price: lot.min };
  const sec = Math.floor(elapsed / 1000) * 1000; // цена меняется ровно раз в секунду
  const frac = Math.min(1, sec / declineMs);
  const price = frac >= 1 ? lot.min : Math.max(lot.min, Math.round((lot.start - (lot.start - lot.min) * frac) / ROUND) * ROUND);
  return { phase: holdActive ? 'held' : 'live', price, atMin: frac >= 1, endAt: lot.startAt + (lot.paused || 0) + durMs };
}
