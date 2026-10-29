// Отправка заказа из мини-аппа в Telegram-группу.
// Токен бота хранится только в переменных окружения Netlify — на странице его нет.
//
// Netlify → Site configuration → Environment variables:
//   BOT_TOKEN         — токен бота от @BotFather (обязательно)
//   ORDER_CHAT_ID     — ID группы заказов, например -1004415110603 (обязательно)
//   REQUIRE_TELEGRAM  — "1", чтобы принимать заказы только из Telegram
import crypto from 'node:crypto';

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 24 * 3600) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch { return null; }
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

  const user = verifyInitData(body.initData, BOT_TOKEN);
  if (!user && process.env.REQUIRE_TELEGRAM === '1') return json(403, { ok: false, error: 'not_telegram' });
  const stamp = user
    ? `✅ Подтверждено Telegram: ${user.username ? '@' + user.username + ' ' : ''}(ID ${user.id})`
    : '⚠️ Не подтверждено Telegram: заказ отправлен не из приложения в Telegram. Проверьте клиента при звонке.';

  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text + '\n\n' + stamp, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return json(502, { ok: false, error: 'telegram' });
    return json(200, { ok: true });
  } catch {
    return json(502, { ok: false, error: 'network' });
  }
};

export const config = { path: '/api/order' };
