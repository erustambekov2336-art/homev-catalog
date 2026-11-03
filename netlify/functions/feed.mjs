// Лента «Недавно заказали»: последние настоящие заказы — только набор и время.
import { getStore } from '@netlify/blobs';
import { json, STORE_NAME } from '../lib/tg.mjs';

export default async () => {
  try {
    const store = getStore({ name: STORE_NAME });
    const list = (await store.get('feed', { type: 'json' })) || [];
    const items = (Array.isArray(list) ? list : []).slice(0, 20).map((x) => ({ id: String(x.id), at: Number(x.at) }));
    return json(200, { ok: true, items }, { 'Cache-Control': 'public, max-age=20' });
  } catch {
    return json(200, { ok: true, items: [] });
  }
};

export const config = { path: '/api/feed' };
