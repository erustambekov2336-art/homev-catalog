// Корзина для напоминания: POST /api/cart
//   { initData, remind: true,  items: [[id, шт, название, цена], ...], total, lang } — сохранить корзину
//   { initData, remind: false }                                               — клиент отказался: удалить
// Храним только у тех, кто согласился на напоминание. Пустая корзина или заказ — запись удаляется.
// Само напоминание шлёт cart-remind.mjs (раз в 30 минут), не раньше чем через сутки.
import { getStore } from '@netlify/blobs';
import { json, verifyInitData, STORE_NAME } from '../lib/tg.mjs';

const ID_RE = /^[\w-]{1,40}$/;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'bad_json' }); }
  const user = verifyInitData(body?.initData, process.env.BOT_TOKEN);
  if (!user) return json(403, { ok: false, error: 'not_telegram' });

  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const key = `cart/${user.id}`;
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((x) => Array.isArray(x) && ID_RE.test(String(x[0])))
    .slice(0, 50)
    .map(([id, q, name, price]) => [String(id), Math.max(1, Math.min(999, Math.round(Number(q) || 1))), String(name || '').slice(0, 80), Math.max(0, Math.round(Number(price) || 0))]);

  if (body.remind === false || !items.length) {
    await store.delete(key).catch(() => {});
    return json(200, { ok: true, saved: false });
  }

  const prev = await store.get(key, { type: 'json' }).catch(() => null);
  const sig = items.map((x) => x[0] + ':' + x[1]).sort().join(',');
  const changed = !prev || prev.sig !== sig;
  await store.setJSON(key, {
    uid: user.id,
    items,
    sig,
    total: Math.max(0, Math.round(Number(body.total) || 0)),
    lang: ['ru', 'uz', 'uzc'].includes(body.lang) ? body.lang : 'ru',
    // отсчёт суток идёт с последнего изменения корзины; если корзина не менялась — не сбрасываем
    updatedAt: changed ? Date.now() : prev.updatedAt,
    remindedAt: prev?.remindedAt || 0,
  });
  return json(200, { ok: true, saved: true }, { 'Cache-Control': 'no-store' });
};

export const config = { path: '/api/cart' };
