// Статистика: POST /api/stats
//   { action: 'views', views: { id: n } }        — телефон присылает пачку просмотров карточек (без личных данных)
//   { action: 'summary', initData }              — сводка для владельца (только ADMIN_IDS)
import { getStore } from '@netlify/blobs';
import { json, verifyInitData, STORE_NAME, isAdmin } from '../lib/tg.mjs';
import { recordViews, summary } from '../lib/stats.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  let body;
  try { body = JSON.parse(await req.text()); } catch { return json(400, { ok: false, error: 'bad_json' }); }
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });

  if (body?.action === 'views') {
    await recordViews(store, body.views).catch((e) => console.error('views failed', e));
    return json(200, { ok: true }, { 'Cache-Control': 'no-store' });
  }

  if (body?.action === 'summary') {
    const user = verifyInitData(body.initData, process.env.BOT_TOKEN);
    if (!isAdmin(user)) return json(403, { ok: false, error: 'forbidden' });
    try {
      return json(200, { ok: true, ...(await summary(store, 30)) }, { 'Cache-Control': 'no-store' });
    } catch (e) {
      console.error('summary failed', e);
      return json(500, { ok: false, error: 'store' });
    }
  }

  return json(400, { ok: false, error: 'action' });
};

export const config = { path: '/api/stats' };
