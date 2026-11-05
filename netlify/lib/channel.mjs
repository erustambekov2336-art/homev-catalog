// Пост лота в Telegram-канале и сообщения бота с фирменными эмодзи.
// Жизнь поста: за 5 минут до старта — анонс с обратным отсчётом → LIVE с текущей ценой → «Продан за …».
// Бот редактирует один и тот же пост (раз в минуту — чаще Telegram не даёт).
import { tgApi, tgCall } from './tg.mjs';
import { priceAt } from './auction.mjs';

export const ANNOUNCE_MS = 5 * 60 * 1000; // за сколько до старта публиковать анонс
const TZ = 'Asia/Tashkent';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/\s/g, ' ');
const hm = (ms) => new Date(ms).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const siteUrl = () => (process.env.URL || '').replace(/\/$/, '');

// ---------- ссылки на мини-апп ----------
let bot = '';
export async function botUsername() {
  if (!bot) bot = (await tgCall('getMe', {}))?.username || '';
  return bot;
}
// Основа ссылки: MINIAPP_LINK (например https://t.me/homevuz_bot/app) или https://t.me/<бот>
// — во втором случае в BotFather должно быть включено основное мини-приложение (Main Mini App).
export async function appBase() {
  const env = (process.env.MINIAPP_LINK || '').trim();
  if (env) return env.split('?')[0].replace(/\/$/, '');
  const b = await botUsername();
  return b ? `https://t.me/${b}` : '';
}
export async function appLink(param) {
  const b = await appBase();
  if (!b) return '';
  return param ? `${b}?startapp=${encodeURIComponent(param)}` : b;
}

// ---------- фирменные эмодзи из пака ----------
const nv = (e) => String(e).replace(/\uFE0F/g, '');
let pack = null;
let packAt = 0;
export async function emojiPack() {
  if (pack && Date.now() - packAt < (Object.keys(pack).length ? 6 * 3600e3 : 10 * 60e3)) return pack;
  const set = await tgCall('getStickerSet', { name: process.env.EMOJI_PACK || 'maisonforfe' });
  const map = {};
  for (const st of set?.stickers || []) {
    if (st.custom_emoji_id && st.emoji && !map[nv(st.emoji)]) map[nv(st.emoji)] = st.custom_emoji_id;
  }
  pack = map;
  packAt = Date.now();
  return map;
}
const emo = (map) => (e) => {
  const id = map && map[nv(e)];
  return id ? `<tg-emoji emoji-id="${id}">${e}</tg-emoji>` : e;
};
// Кнопки задаются как [текст, эмодзи, ссылка]; с паком эмодзи встаёт иконкой, без него — в текст.
const keyboard = (rows, map, kind = 'url') => ({
  inline_keyboard: rows.map((row) => row.filter((b) => b && b[2]).map(([text, e, link]) => {
    const id = map && map[nv(e)];
    const target = kind === 'web_app' ? { web_app: { url: link } } : { url: link };
    return id ? { text, icon_custom_emoji_id: id, ...target } : { text: `${e} ${text}`, ...target };
  })).filter((r) => r.length),
});

// ---------- текст поста ----------
async function render(lot, now, map) {
  const e = emo(map);
  const p = priceAt(lot, now);
  const cat = lot.catalogPrice || 0;
  const pct = (x) => (cat > x ? Math.floor((1 - x / cat) * 100) : 0);
  const L = {
    item: await appLink('i_' + lot.itemId),
    cat: await appLink('cat'),
    auction: await appLink('auction'),
    remind: await appLink('remind_' + lot.id),
    offer: await appLink('offer_' + lot.id),
  };
  const name = L.item ? `<a href="${esc(L.item)}">${esc(lot.itemName)}</a>` : esc(lot.itemName);
  const range = `${e('💎')} Цена: <b>${num(lot.start)} → ${num(lot.min)} сум</b>`;
  const catLine = cat ? `${e('🏷')} В каталоге: ${num(cat)} сум${pct(lot.min) ? ` · экономия до −${pct(lot.min)}%` : ''}` : null;
  const startsAt = lot.startAt + (lot.paused || 0);
  let head;
  let tail = [];
  let rows = [];

  if (p.phase === 'scheduled') {
    const mins = Math.max(1, Math.ceil((startsAt - now) / 60000));
    head = `${e('⏳')} <b>Аукцион через ${mins} мин</b>`;
    tail = [
      `${e('⏱')} Старт в ${hm(startsAt)} · лот идёт ${lot.durationMin} мин`,
      'Цена будет падать каждую секунду. Кто первым нажмёт «Забрать», тот и купил.',
    ];
    rows = [[['Напомнить о старте', '🔔', L.remind]], [['Смотреть другие позиции в каталоге', '🛍', L.cat]]];
  } else if (p.phase === 'live' || p.phase === 'held') {
    const left = Math.max(1, Math.ceil(((p.endAt || now) - now) / 60000));
    head = `${e('🔴')} <b>LIVE · аукцион идёт</b>`;
    tail = [
      `${e('🔨')} Цена сейчас: <b>${num(p.price)} сум</b>${pct(p.price) ? ` (−${pct(p.price)}%)` : ''}`,
      `Обновлено в ${hm(now)} · осталось ~${left} мин`,
      p.phase === 'held'
        ? 'Лот сейчас оформляет покупатель. Если он не успеет за 2 минуты, торги продолжатся.'
        : 'Цена падает каждую секунду, точная цена — в приложении.',
    ];
    rows = [[['Перейти на аукцион', '🔨', L.auction]], [['Предложить свою цену', '💬', L.offer]], [['Каталог', '🛍', L.cat]]];
  } else if (p.phase === 'sold') {
    head = `${e('✅')} <b>Продан за ${num(p.price)} сум</b>`;
    tail = ['Следите за каналом: анонс следующего лота — за 5 минут до старта.'];
    rows = [[['Смотреть другие позиции в каталоге', '🛍', L.cat]], [['Следующие лоты', '🔨', L.auction]]];
  } else if (p.phase === 'ended') {
    head = `${e('⌛')} <b>Аукцион завершён</b>`;
    tail = ['Лот ушёл без продажи. Следите за следующими лотами.'];
    rows = [[['Смотреть другие позиции в каталоге', '🛍', L.cat]]];
  } else {
    head = `<b>Лот снят с аукциона</b>`;
    rows = [[['Смотреть другие позиции в каталоге', '🛍', L.cat]]];
  }
  const text = [head, '', `<b>${name}</b>`, range, catLine, '', ...tail].filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, markup: keyboard(rows, map), kind: p.phase === 'held' ? 'live' : p.phase };
}

const photoUrl = (lot) => (lot.photo && siteUrl() ? `${siteUrl()}/uploads/homev-catalog-redesign/photos/${encodeURIComponent(lot.photo)}` : '');
const notModified = (r) => /not modified/i.test(r?.description || '');

// Новый пост. Сначала с фирменными эмодзи; если Telegram откажет (в каналах они доступны
// только ботам с юзернеймом с Fragment) — тот же пост с обычными эмодзи.
export async function channelPost(lot, now) {
  const ch = process.env.CHANNEL_ID;
  if (!ch) return null;
  const map = await emojiPack();
  const modes = Object.keys(map).length ? [true, false] : [false];
  const photo = photoUrl(lot);
  for (const rich of modes) {
    const r = await render(lot, now, rich ? map : null);
    const base = { chat_id: ch, parse_mode: 'HTML', reply_markup: r.markup };
    let res = photo ? await tgApi('sendPhoto', { ...base, photo, caption: r.text }) : null;
    if (res?.ok) return { channelMsg: res.result.message_id, channelPhoto: true, channelRich: rich, channelText: r.text, channelKind: r.kind };
    res = await tgApi('sendMessage', { ...base, text: r.text, link_preview_options: { is_disabled: true } });
    if (res?.ok) return { channelMsg: res.result.message_id, channelPhoto: false, channelRich: rich, channelText: r.text, channelKind: r.kind };
  }
  return null;
}

// Обновляет существующий пост. Возвращает изменённые поля лота или null, если менять нечего.
export async function channelEdit(lot, now) {
  const ch = process.env.CHANNEL_ID;
  if (!ch || !lot.channelMsg) return null;
  const map = lot.channelRich === false ? null : await emojiPack();
  const photo = lot.channelPhoto !== false;
  const send = async (m) => {
    const r = await render(lot, now, m);
    if (r.text === lot.channelText) return { same: true, r };
    const base = { chat_id: ch, message_id: lot.channelMsg, parse_mode: 'HTML', reply_markup: r.markup };
    const res = photo
      ? await tgApi('editMessageCaption', { ...base, caption: r.text })
      : await tgApi('editMessageText', { ...base, text: r.text, link_preview_options: { is_disabled: true } });
    return { ok: res?.ok || notModified(res), r };
  };
  let out = await send(map && Object.keys(map).length ? map : null);
  if (out.same) return null;
  if (!out.ok && map) {
    out = await send(null);
    if (out.ok) return { channelText: out.r.text, channelKind: out.r.kind, channelRich: false };
  }
  return out.ok ? { channelText: out.r.text, channelKind: out.r.kind } : null;
}

// ---------- личные сообщения от бота ----------
// html(e) строит текст, где e('🔔') даёт фирменное эмодзи; rows — кнопки мини-аппа [текст, эмодзи, url].
export async function dm(chatId, html, rows = []) {
  const map = await emojiPack();
  const tries = Object.keys(map).length ? [map, null] : [null];
  for (const m of tries) {
    const res = await tgApi('sendMessage', {
      chat_id: chatId,
      text: html(emo(m)),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(rows.length ? { reply_markup: keyboard(rows, m, 'web_app') } : {}),
    });
    if (res?.ok) return true;
    if (res && /blocked|chat not found|deactivated/i.test(res.description || '')) return false;
  }
  return false;
}

// Сразу после продажи или отмены — обновить пост, не дожидаясь планировщика.
export async function channelNow(lot) {
  try { return await channelEdit(lot, Date.now()); } catch { return null; }
}

export { esc, num };
