// Статус сертификата клиента — одинаковый на телефоне, компьютере и планшете.
import { getStore } from '@netlify/blobs';
import { json, verifyInitData, STORE_NAME } from '../lib/tg.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false }); }
  const user = verifyInitData(body?.initData, process.env.BOT_TOKEN);
  if (!user) return json(200, { ok: false, guest: true });
  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const rec = await store.get(`cert/${user.id}`, { type: 'json' });
    return json(200, { ok: true, certUsed: !!rec, order: rec?.order || '' }, { 'Cache-Control': 'no-store' });
  } catch {
    return json(200, { ok: false });
  }
};

export const config = { path: '/api/me' };
