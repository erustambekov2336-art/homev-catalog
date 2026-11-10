// Напоминание о брошенной корзине. Запускается каждые 30 минут.
// Правила, чтобы не надоедать:
//   • только тем, кто сам согласился (корзина есть в хранилище только у них);
//   • через 24 часа после последнего изменения корзины, и не если корзине больше 7 дней;
//   • одно напоминание на одну и ту же корзину и не чаще раза в 3 дня;
//   • только с 10:00 до 20:59 по Ташкенту;
//   • в сообщении есть кнопка «Больше не напоминать».
// Если клиент заблокировал бота — запись удаляется.
import { getStore } from '@netlify/blobs';
import { STORE_NAME } from '../lib/tg.mjs';
import { dm, esc, num } from '../lib/channel.mjs';

const DAY = 86400000;
const AFTER_MS = 1 * DAY;
const MAX_AGE_MS = 7 * DAY;
const COOLDOWN_MS = 3 * DAY;
const CERT_AMOUNT = 500000;
const CERT_MIN = 3000000;
const siteUrl = () => (process.env.URL || '').replace(/\/$/, '');
const pause = () => new Promise((r) => setTimeout(r, 60));

const T = {
  ru: {
    hi: (n, s) => `Вы оставили в корзине ${n} ${n === 1 ? 'товар' : n < 5 ? 'товара' : 'товаров'} на <b>${s} сум</b>:`,
    more: (n) => `…и ещё ${n}`,
    cert: `🎁 Ваш сертификат на ${num(CERT_AMOUNT)} сум применится к этому заказу.`,
    end: 'Товары ждут вас — оформить заказ можно в пару нажатий.',
    open: 'Открыть корзину', off: 'Больше не напоминать',
  },
  uz: {
    hi: (n, s) => `Savatingizda ${n} ta mahsulot qoldi, jami <b>${s} so‘m</b>:`,
    more: (n) => `…va yana ${n} ta`,
    cert: `🎁 ${num(CERT_AMOUNT)} so‘mlik sertifikatingiz shu buyurtmaga qo‘llanadi.`,
    end: 'Mahsulotlar sizni kutmoqda — buyurtmani bir necha bosishda rasmiylashtirish mumkin.',
    open: 'Savatni ochish', off: 'Boshqa eslatmang',
  },
};

export default async () => {
  const now = Date.now();
  const hour = new Date(now + 5 * 3600000).getUTCHours(); // Ташкент, UTC+5
  if (hour < 10 || hour >= 21) return new Response('quiet hours');
  if (!siteUrl()) return new Response('no URL');

  const s = getStore({ name: STORE_NAME, consistency: 'strong' });
  const { blobs } = await s.list({ prefix: 'cart/' }).catch(() => ({ blobs: [] }));
  let sent = 0;
  for (const b of blobs) {
    if (sent >= 200) break;
    const c = await s.get(b.key, { type: 'json' }).catch(() => null);
    if (!c || !Array.isArray(c.items) || !c.items.length) { await s.delete(b.key).catch(() => {}); continue; }
    const age = now - (c.updatedAt || 0);
    if (age > MAX_AGE_MS) { await s.delete(b.key).catch(() => {}); continue; }
    if (age < AFTER_MS) continue;
    if (c.remindedAt && c.remindedAt >= c.updatedAt) continue; // эту корзину уже напоминали
    if (c.remindedAt && now - c.remindedAt < COOLDOWN_MS) continue;

    // клиент уже потратил сертификат? — тогда про него не пишем
    const certUsed = !!(await s.get(`cert/${c.uid}`, { type: 'json' }).catch(() => null));
    const t = T[c.lang === 'ru' ? 'ru' : 'uz'];
    const count = c.items.reduce((a, x) => a + (x[1] || 1), 0);
    const lines = c.items.slice(0, 4).map((x) => `• ${esc(x[2] || 'Товар')}${x[1] > 1 ? ' × ' + x[1] : ''}`);
    if (c.items.length > 4) lines.push(t.more(c.items.length - 4));
    const html = () => [
      t.hi(count, num(c.total)), '', ...lines, '',
      ...(!certUsed && c.total >= CERT_MIN ? [t.cert, ''] : []),
      t.end,
    ].join('\n');

    // ставим отметку до отправки: если функция упадёт посередине, клиент не получит сообщение дважды
    await s.setJSON(b.key, { ...c, remindedAt: now }).catch(() => {});
    const ok = await dm(c.uid, html, [[[t.open, '🛍', siteUrl() + '/?go=cart']], [[t.off, '🔕', siteUrl() + '/?go=nocart']]]);
    // не доставлено (бот заблокирован или клиент не разрешал писать) — запись удаляем, больше не пытаемся
    if (ok === false) await s.delete(b.key).catch(() => {});
    else sent++;
    await pause();
  }
  return new Response(`sent ${sent}`);
};

export const config = { schedule: '*/30 * * * *' };
