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
