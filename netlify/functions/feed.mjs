// Лента «Недавно заказали»: последние настоящие заказы — только набор и время.
import { getStore } from '@netlify/blobs';
import { json, STORE_NAME } from '../lib/tg.mjs';

export default async () => {
  try {
    // strong: свежий заказ виден сразу (обычное чтение Blobs может отставать до минуты)
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const list = (await store.get('feed', { type: 'json' })) || [];
    const items = (Array.isArray(list) ? list : []).slice(0, 20).map((x) => ({ id: String(x.id), at: Number(x.at) }));
    return json(200, { ok: true, items }, { 'Cache-Control': 'no-store' });
  } catch (e) {
    console.error('feed read failed', e);
    return json(200, { ok: true, items: [], error: 'store' }, { 'Cache-Control': 'no-store' });
  }
};

export const config = { path: '/api/feed' };
