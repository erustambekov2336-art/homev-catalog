// Запускается каждую минуту:
//   • за ~5 минут до старта лота — напоминания подписавшимся;
//   • в момент старта — пост в Telegram-канал (если задан CHANNEL_ID);
//   • ценовые уведомления «сообщить, когда цена опустится до …».
import { getStore } from '@netlify/blobs';
import { STORE_NAME, tgSend, tgCall, sum } from '../lib/tg.mjs';
import { norm, priceAt } from '../lib/auction.mjs';

const siteUrl = () => (process.env.URL || '').replace(/\/$/, '');
const appButton = (text) =>
  process.env.URL ? { reply_markup: { inline_keyboard: [[{ text, web_app: { url: siteUrl() + '/#auction' } }]] } } : {};

// Ссылка для кнопки в канале (там нельзя кнопку мини-аппа): MINIAPP_LINK или чат бота.
let botName = null;
async function channelLink() {
  if (process.env.MINIAPP_LINK) return process.env.MINIAPP_LINK;
  if (!botName) botName = (await tgCall('getMe', {}))?.username || '';
  return botName ? `https://t.me/${botName}` : null;
}

// Атомарно меняет лот; fn возвращает false, если менять не нужно.
async function patch(s, key, fn) {
  for (let i = 0; i < 4; i++) {
    const cur = await s.getWithMetadata(key, { type: 'json' });
    if (!cur) return null;
    const lot = cur.data;
    if (fn(lot) === false) return null;
    const w = await s.setJSON(key, lot, { onlyIfMatch: cur.etag });
    if (w.modified) return lot;
  }
  return null;
}

export default async () => {
  const s = getStore({ name: STORE_NAME, consistency: 'strong' });
  const now = Date.now();
  const { blobs } = await s.list({ prefix: 'lot/' });

  for (const b of blobs) {
    const raw = await s.get(b.key, { type: 'json' });
    if (!raw || raw.status !== 'active') continue;
    const lot = norm(raw, now);
    const p = priceAt(lot, now);
    const startsIn = lot.startAt + (lot.paused || 0) - now;

    // 1) напоминание за ~5 минут до старта
    if (!raw.notified && startsIn <= 6 * 60000 && startsIn > -3 * 60000) {
      const marked = await patch(s, b.key, (l) => (l.notified ? false : ((l.notified = true), true)));
      if (marked) {
        const own = (await s.get('remind/' + lot.id, { type: 'json' })) || [];
        const general = (await s.get('remind/next', { type: 'json' })) || [];
        await s.delete('remind/next').catch(() => {});
        const mins = Math.max(0, Math.round(startsIn / 60000));
        const text = `🔔 ${mins > 0 ? `Через ${mins} мин начнётся` : 'Начался'} аукцион Maison Forfè\n\n${lot.itemName}\nСтарт: ${sum(lot.start)}. Цена снижается каждую секунду, пока кто-то не купит.`;
        for (const id of [...new Set([...own, ...general])].slice(0, 500)) {
          await tgSend(id, text, appButton('Открыть аукцион'));
          await new Promise((r) => setTimeout(r, 40));
        }
      }
    }

    // 2) пост в канал при старте лота
    if (process.env.CHANNEL_ID && !raw.posted && (p.phase === 'live' || p.phase === 'held')) {
      const marked = await patch(s, b.key, (l) => (l.posted ? false : ((l.posted = true), true)));
      if (marked) {
        const link = await channelLink();
        const disc = lot.catalogPrice > lot.start ? ` (в каталоге ${sum(lot.catalogPrice)})` : '';
        const caption = `🔨 Аукцион начался!\n\n${lot.itemName}\nСтарт: ${sum(lot.start)}${disc}\nЦена снижается каждую секунду — кто первый нажмёт «Купить», тот и забирает.\n\nЛот идёт ${lot.durationMin} мин.`;
        const markup = link ? { reply_markup: { inline_keyboard: [[{ text: 'Участвовать в аукционе', url: link }]] } } : {};
        const photo = lot.photo ? `${siteUrl()}/uploads/homev-catalog-redesign/photos/${encodeURIComponent(lot.photo)}` : '';
        let msg = photo && process.env.URL ? await tgCall('sendPhoto', { chat_id: process.env.CHANNEL_ID, photo, caption, ...markup }) : null;
        if (!msg) msg = await tgCall('sendMessage', { chat_id: process.env.CHANNEL_ID, text: caption, ...markup });
        if (msg) await patch(s, b.key, (l) => ((l.channelMsg = msg.message_id), true));
      }
    }

    // 3) ценовые уведомления: сообщаем, когда цена дойдёт до нужной в ближайшие ~40 секунд
    if ((p.phase === 'live' || p.phase === 'held') && (raw.alerts || []).some((a) => !a.sent)) {
      const soon = priceAt(lot, now + 40000).price;
      const due = [];
      await patch(s, b.key, (l) => {
        due.length = 0;
        for (const a of l.alerts || []) if (!a.sent && soon <= a.price) { a.sent = true; due.push(a); }
        return due.length > 0;
      });
      for (const a of due) {
        await tgSend(a.uid, `🔔 «${lot.itemName}»: цена опускается до ${sum(a.price)}!\nЛот могут забрать в любую секунду — откройте аукцион.`, appButton('Открыть аукцион'));
        await new Promise((r) => setTimeout(r, 40));
      }
    }
  }
  return new Response('ok');
};

export const config = { schedule: '* * * * *' };
