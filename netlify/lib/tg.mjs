// Общие помощники для функций: ответ JSON и проверка, что запрос пришёл из Telegram.
import crypto from 'node:crypto';

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

// Проверяет подпись initData от Telegram. Возвращает пользователя или null.
export function verifyInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string' || !botToken) return null;
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
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

export const STORE_NAME = 'maison-forfe';

// Отправка сообщения ботом. Возвращает true, если Telegram принял сообщение.
export async function tgSend(chatId, text, extra = {}) {
  const token = process.env.BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.ok;
  } catch {
    return false;
  }
}

// Кто может управлять аукционом: Telegram ID через запятую в ADMIN_IDS (по умолчанию — владелец).
export const ADMIN_IDS = (process.env.ADMIN_IDS || '349086871').split(',').map((s) => s.trim()).filter(Boolean);
export const isAdmin = (user) => !!user && ADMIN_IDS.includes(String(user.id));

export const sum = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' сум';

// Любой метод Bot API. Возвращает result или null.
export async function tgCall(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.ok ? j.result : null;
  } catch {
    return null;
  }
}

// Любой метод Bot API с ответом Telegram целиком: { ok, result, description }.
export async function tgApi(method, payload) {
  const token = process.env.BOT_TOKEN;
  if (!token) return { ok: false, description: 'no token' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await r.json().catch(() => ({ ok: false, description: 'bad json' }));
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}
