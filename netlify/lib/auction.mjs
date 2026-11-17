// Распродажа: цена РАСТЁТ каждую секунду от минимума до максимума с точностью до 1 сума —
// чем раньше покупатель нажмёт «Забрать», тем дешевле.
// Поля лота остались прежними: lot.min — цена на старте (минимум), lot.start — максимальная цена.
// Шаг в секунду считается сам: (максимум − минимум) / (90% длительности в секундах).
// Эта же формула продублирована в public/index.html — меняйте обе вместе.
export const HOLD_MS = 2 * 60 * 1000; // сколько цена закреплена за покупателем, пока он заполняет форму
export const DECLINE_SHARE = 0.9;     // цена растёт 90% времени лота, последние 10% — по максимальной цене
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
  if (elapsed < 0) return { phase: 'scheduled', price: lot.min, startsAt: lot.startAt + (lot.paused || 0) };
  if (elapsed >= durMs && !holdActive) return { phase: 'ended', price: lot.start };
  const sec = Math.floor(elapsed / 1000) * 1000; // цена меняется ровно раз в секунду
  const frac = Math.min(1, sec / declineMs);
  const price = frac >= 1 ? lot.start : Math.min(lot.start, Math.round((lot.min + (lot.start - lot.min) * frac) / ROUND) * ROUND);
  return { phase: holdActive ? 'held' : 'live', price, atMax: frac >= 1, endAt: lot.startAt + (lot.paused || 0) + durMs };
}
