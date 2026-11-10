// Статистика для владельца: заказы, выручка и просмотры товаров по дням (время Ташкента, UTC+5).
// Каждый день — один документ в Blobs: stats/day/2026-11-10
//   { orders, revenue, auction, items: { id: штук }, views: { id: просмотров }, viewTotal }
// Тестовые заказы (комментарий «тест» / «test») сюда не попадают.

const TZ_MS = 5 * 3600 * 1000;
export const dayKey = (ts = Date.now()) => new Date(ts + TZ_MS).toISOString().slice(0, 10);
const ID_RE = /^[\w-]{1,40}$/;

async function bumpDay(store, ts, fn) {
  const key = 'stats/day/' + dayKey(ts);
  for (let i = 0; i < 6; i++) {
    const cur = await store.getWithMetadata(key, { type: 'json' });
    const d = cur && cur.data && typeof cur.data === 'object' ? cur.data : {};
    d.orders ||= 0; d.revenue ||= 0; d.auction ||= 0; d.viewTotal ||= 0;
    d.items ||= {}; d.views ||= {};
    fn(d);
    const res = await store.setJSON(key, d, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (!res || res.modified !== false) return true;
  }
  return false;
}

// items: [[id, штук], ...]; total — сумма к оплате в сумах; source: 'cart' | 'auction'
export async function recordOrder(store, { items, total, source = 'cart', ts = Date.now() }) {
  const list = (Array.isArray(items) ? items : [])
    .filter((x) => Array.isArray(x) && ID_RE.test(String(x[0])))
    .slice(0, 100)
    .map((x) => [String(x[0]), Math.max(1, Math.min(999, Math.round(Number(x[1]) || 1)))]);
  const sum = Math.max(0, Math.round(Number(total) || 0));
  return bumpDay(store, ts, (d) => {
    d.orders += 1;
    d.revenue += sum;
    if (source === 'auction') d.auction += 1;
    for (const [id, q] of list) d.items[id] = (d.items[id] || 0) + q;
  });
}

// views: { id: сколько раз открыли карточку } — пачкой с телефона
export async function recordViews(store, views, ts = Date.now()) {
  const list = Object.entries(views && typeof views === 'object' ? views : {})
    .filter(([id]) => ID_RE.test(id))
    .slice(0, 40)
    .map(([id, n]) => [id, Math.max(1, Math.min(20, Math.round(Number(n) || 1)))]);
  if (!list.length) return true;
  return bumpDay(store, ts, (d) => {
    for (const [id, n] of list) { d.views[id] = (d.views[id] || 0) + n; d.viewTotal += n; }
  });
}

// Сводка за последние `days` дней (по умолчанию 30): по дням + итоги + топы
export async function summary(store, days = 30) {
  const now = Date.now();
  const keys = Array.from({ length: days }, (_, i) => dayKey(now - i * 86400000));
  const docs = await Promise.all(keys.map((k) => store.get('stats/day/' + k, { type: 'json' }).catch(() => null)));
  const series = keys.map((day, i) => {
    const d = docs[i] || {};
    return { day, orders: d.orders || 0, revenue: d.revenue || 0, auction: d.auction || 0, views: d.viewTotal || 0 };
  }).reverse(); // от старых к новым

  const total = (n) => {
    const part = series.slice(-n);
    const t = part.reduce((a, x) => ({ orders: a.orders + x.orders, revenue: a.revenue + x.revenue, auction: a.auction + x.auction, views: a.views + x.views }), { orders: 0, revenue: 0, auction: 0, views: 0 });
    t.avg = t.orders ? Math.round(t.revenue / t.orders) : 0;
    return t;
  };
  const ordered = {}, viewed = {};
  docs.forEach((d) => {
    if (!d) return;
    for (const [id, q] of Object.entries(d.items || {})) ordered[id] = (ordered[id] || 0) + q;
    for (const [id, n] of Object.entries(d.views || {})) viewed[id] = (viewed[id] || 0) + n;
  });
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ id, n, ordered: ordered[id] || 0, viewed: viewed[id] || 0 }));
  const first = series.find((x) => x.orders || x.views);
  return {
    today: total(1), week: total(7), month: total(days),
    series: series.slice(-14),
    topOrdered: top(ordered), topViewed: top(viewed),
    since: first ? first.day : null, tz: 'Asia/Tashkent',
  };
}
