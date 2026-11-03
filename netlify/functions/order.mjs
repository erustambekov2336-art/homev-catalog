// Отправка заказа из мини-аппа в Telegram-группу.
// Токен бота хранится только в переменных окружения Netlify — на странице его нет.
//
// Netlify → Project configuration → Environment variables:
//   BOT_TOKEN         — токен бота от @BotFather (обязательно, как секрет)
//   ORDER_CHAT_ID     — ID группы заказов, например -1004415110603 (обязательно)
//   REQUIRE_TELEGRAM  — "1", чтобы принимать заказы только из Telegram
//
// Дополнительно функция:
//   • проверяет, что сертификат 500 000 сум клиент использует один раз (хранилище Netlify Blobs);
//   • добавляет заказанные наборы в ленту «Недавно заказали» (без имён и телефонов).
import { getStore } from '@netlify/blobs';
import { json, verifyInitData, STORE_NAME } from '../lib/tg.mjs';

const CERT_AMOUNT = 500000;
const CERT_MIN = 3000000;
const sum = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' сум';

async function addToFeed(store, items) {
  const now = Date.now();
  const add = items
    .filter((x) => Array.isArray(x) && typeof x[0] === 'string' && /^[\w-]{1,40}$/.test(x[0]))
    .slice(0, 3)
    .map((x) => ({ id: x[0], at: now }));
  if (!add.length) return;
  for (let i = 0; i < 4; i++) {
    const cur = await store.getWithMetadata('feed', { type: 'json' });
    const prev = cur && Array.isArray(cur.data) ? cur.data : [];
    const list = [...add, ...prev].slice(0, 30);
    const res = await store.setJSON('feed', list, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (res.modified) return;
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.ORDER_CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) return json(500, { ok: false, error: 'not_configured' });

  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'bad_json' }); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 3500 || !text.includes('Новый заказ')) return json(400, { ok: false, error: 'bad_order' });
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};

  const user = verifyInitData(body.initData, BOT_TOKEN);
  if (!user && process.env.REQUIRE_TELEGRAM === '1') return json(403, { ok: false, error: 'not_telegram' });

  let store = null;
  try { store = getStore({ name: STORE_NAME, consistency: 'strong' }); } catch { store = null; }

  // --- проверка сертификата
  const notes = [];
  let reservedKey = null;
  const discount = Number(meta.discount) || 0;
  const subtotal = Number(meta.sub) || 0;
  if (discount > 0) {
    if (!user) {
      notes.push(`⚠️ Сертификат применён вне Telegram, проверить нельзя. Без сертификата к оплате: ${sum(subtotal)}`);
    } else if (discount !== CERT_AMOUNT || subtotal < CERT_MIN) {
      notes.push(`⚠️ Сертификат применён неверно — скидку не давать. К оплате: ${sum(subtotal)}`);
    } else if (!store) {
      notes.push('⚠️ Не удалось проверить сертификат — уточните вручную.');
    } else {
      const key = `cert/${user.id}`;
      try {
        const res = await store.setJSON(key, { order: String(meta.no || '').slice(0, 40), at: Date.now() }, { onlyIfNew: true });
        if (res.modified) {
          reservedKey = key;
        } else {
          const prev = await store.get(key, { type: 'json' }).catch(() => null);
          notes.push(`⚠️ Сертификат уже использован${prev?.order ? ' в заказе ' + prev.order : ''} — скидку не давать. К оплате без сертификата: ${sum(subtotal)}`);
        }
      } catch {
        notes.push('⚠️ Не удалось проверить сертификат — уточните вручную.');
      }
    }
  }

  const stamp = user
    ? `✅ Подтверждено Telegram: ${user.username ? '@' + user.username + ' ' : ''}(ID ${user.id})`
    : '⚠️ Не подтверждено Telegram: заказ отправлен не из приложения в Telegram. Проверьте клиента при звонке.';
  const message = [text, ...(notes.length ? ['', ...notes] : []), '', stamp].join('\n');

  let sent = false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    sent = r.ok && j.ok;
  } catch {
    sent = false;
  }

  if (!sent) {
    // заказ не ушёл — сертификат не считаем использованным
    if (reservedKey && store) await store.delete(reservedKey).catch(() => {});
    return json(502, { ok: false, error: 'telegram' });
  }

  // --- лента «Недавно заказали»: только подтверждённые заказы из Telegram, без тестовых
  if (user && store && !meta.test && Array.isArray(meta.items)) {
    await addToFeed(store, meta.items).catch(() => {});
  }

  return json(200, { ok: true, certOk: notes.length === 0 });
};

export const config = { path: '/api/order' };
