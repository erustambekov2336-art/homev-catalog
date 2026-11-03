// Каждые 2 минуты: за ~5 минут до старта лота бот присылает напоминание подписавшимся.
import { getStore } from '@netlify/blobs';
import { STORE_NAME, tgSend, sum } from '../lib/tg.mjs';
import { norm } from '../lib/auction.mjs';

export default async () => {
  const s = getStore({ name: STORE_NAME, consistency: 'strong' });
  const now = Date.now();
  const { blobs } = await s.list({ prefix: 'lot/' });
  for (const b of blobs) {
    const cur = await s.getWithMetadata(b.key, { type: 'json' });
    if (!cur) continue;
    const lot = norm(cur.data, now);
    const startsIn = lot.startAt - now;
    if (lot.status !== 'active' || lot.notified || startsIn > 6 * 60000 || startsIn < -3 * 60000) continue;
    const w = await s.setJSON(b.key, { ...cur.data, notified: true }, { onlyIfMatch: cur.etag });
    if (!w.modified) continue; // другой запуск уже рассылает
    const own = (await s.get('remind/' + lot.id, { type: 'json' })) || [];
    const general = (await s.get('remind/next', { type: 'json' })) || [];
    const uids = [...new Set([...own, ...general])].slice(0, 500);
    await s.delete('remind/next').catch(() => {});
    const mins = Math.max(0, Math.round(startsIn / 60000));
    const text = `🔔 ${mins > 0 ? `Через ${mins} мин начнётся` : 'Начался'} аукцион Maison Forfè\n\n${lot.itemName}\nСтарт: ${sum(lot.start)}. Цена снижается каждые ${lot.stepMin} мин, пока кто-то не купит.`;
    const url = (process.env.URL || '').replace(/\/$/, '') + '/#auction';
    const extra = process.env.URL ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть аукцион', web_app: { url } }]] } } : {};
    for (const id of uids) {
      await tgSend(id, text, extra);
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  return new Response('ok');
};

export const config = { schedule: '*/2 * * * *' };
