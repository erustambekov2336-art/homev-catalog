// Запускается каждую минуту:
//   • за 5 минут до старта — анонс в канале с обратным отсчётом и напоминания подписавшимся;
//   • на старте — пост превращается в LIVE, подписавшимся в последние минуты приходит «Начался»;
//   • во время торгов — в посте обновляется текущая цена; после продажи — «Продан за …»;
//   • ценовые уведомления «сообщить, когда цена опустится до …».
import { getStore } from '@netlify/blobs';
import { STORE_NAME } from '../lib/tg.mjs';
import { norm, priceAt } from '../lib/auction.mjs';
import { ANNOUNCE_MS, channelPost, channelEdit, dm, esc, num } from '../lib/channel.mjs';

const siteUrl = () => (process.env.URL || '').replace(/\/$/, '');
const openBtn = (text) => (process.env.URL ? [[[text, '🔨', siteUrl() + '/#auction']]] : []);
const pause = () => new Promise((r) => setTimeout(r, 40));

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
const getList = async (s, key) => {
  const v = await s.get(key, { type: 'json' }).catch(() => null);
  return Array.isArray(v) ? v : [];
};

// Рассылка напоминаний; помнит, кому уже отправлено, чтобы не писать дважды.
async function remindAll(s, lot, ids, html) {
  const done = new Set(await getList(s, 'remindDone/' + lot.id));
  const todo = [...new Set(ids)].filter((id) => !done.has(id)).slice(0, 500);
  for (const id of todo) {
    await dm(id, html, openBtn('Открыть аукцион'));
    done.add(id);
    await pause();
  }
  if (todo.length) await s.setJSON('remindDone/' + lot.id, [...done].slice(-3000)).catch(() => {});
}

export default async () => {
  const s = getStore({ name: STORE_NAME, consistency: 'strong' });
  const now = Date.now();
  const { blobs } = await s.list({ prefix: 'lot/' });

  for (const b of blobs) {
    const raw = await s.get(b.key, { type: 'json' });
    if (!raw) continue;
    const lot = norm(raw, now);
    const p = priceAt(lot, now);
    const startsIn = lot.startAt + (lot.paused || 0) - now;
    const active = raw.status === 'active';
    const running = p.phase === 'live' || p.phase === 'held';

    // 1) напоминание за 5 минут до старта: всем, кто нажал «Напомнить»
    if (active && !raw.notified && startsIn <= ANNOUNCE_MS + 60000 && startsIn > -3 * 60000) {
      const marked = await patch(s, b.key, (l) => (l.notified ? false : ((l.notified = true), true)));
      if (marked) {
        const own = await getList(s, 'remind/' + lot.id);
        const general = await getList(s, 'remind/next');
        await s.delete('remind/next').catch(() => {});
        const mins = Math.max(0, Math.round(startsIn / 60000));
        await remindAll(s, lot, [...own, ...general], (e) =>
          `${e('🔔')} <b>${mins > 0 ? `Через ${mins} мин начнётся` : 'Начался'} аукцион Maison Forfè</b>\n\n${esc(lot.itemName)}\n${e('💎')} ${num(lot.start)} → ${num(lot.min)} сум\nЦена снижается каждую секунду, пока кто-то не купит.`);
      }
    }

    // 2) на старте: «Начался» тем, кто подписался уже после анонса (например, из канала)
    if (active && running && !raw.startNotified) {
      const marked = await patch(s, b.key, (l) => (l.startNotified ? false : ((l.startNotified = true), true)));
      if (marked) {
        await remindAll(s, lot, await getList(s, 'remind/' + lot.id), (e) =>
          `${e('🔴')} <b>Аукцион начался!</b>\n\n${esc(lot.itemName)}\n${e('🔨')} Сейчас ${num(p.price)} сум, цена падает каждую секунду.`);
      }
    }

    // 3) пост в канале: анонс → LIVE → итог
    if (process.env.CHANNEL_ID && !raw.channelFinal) {
      const wantPost = active && ((p.phase === 'scheduled' && startsIn <= ANNOUNCE_MS + 30000) || running);
      if (!raw.channelMsg && wantPost && (raw.chTries || 0) < 3) {
        const marked = await patch(s, b.key, (l) => (l.channelMsg || l.chPosting ? false : ((l.chPosting = true), (l.chTries = (l.chTries || 0) + 1), true)));
        if (marked) {
          const res = await channelPost(lot, now);
          await patch(s, b.key, (l) => { Object.assign(l, res || {}); l.chPosting = false; return true; });
        }
      } else if (raw.channelMsg) {
        const fin = ['sold', 'ended', 'cancelled'].includes(p.phase);
        if (fin || running || p.phase === 'scheduled') {
          const res = await channelEdit(lot, now);
          if (res || fin) await patch(s, b.key, (l) => { Object.assign(l, res || {}); if (fin) l.channelFinal = true; return true; });
        }
      }
    }

    // 4) ценовые уведомления: сообщаем, когда цена дойдёт до нужной в ближайшие ~40 секунд
    if (active && running && (raw.alerts || []).some((a) => !a.sent)) {
      const soon = priceAt(lot, now + 40000).price;
      const due = [];
      await patch(s, b.key, (l) => {
        due.length = 0;
        for (const a of l.alerts || []) if (!a.sent && soon <= a.price) { a.sent = true; due.push(a); }
        return due.length > 0;
      });
      for (const a of due) {
        await dm(a.uid, (e) => `${e('🔔')} «${esc(lot.itemName)}»: цена опускается до <b>${num(a.price)} сум</b>!\nЛот могут забрать в любую секунду — откройте аукцион.`, openBtn('Открыть аукцион'));
        await pause();
      }
    }
  }

  // 5) уборка отметок «смотрят сейчас» старше 3 минут
  const { blobs: seen } = await s.list({ prefix: 'seen/' }).catch(() => ({ blobs: [] }));
  const old = Math.floor(now / 30000) - 6;
  for (const x of seen) {
    if (Number(x.key.split('/')[2]) < old) await s.delete(x.key).catch(() => {});
  }
  return new Response('ok');
};

export const config = { schedule: '* * * * *' };
