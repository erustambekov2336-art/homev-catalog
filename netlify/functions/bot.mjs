// Бот в личных сообщениях: приветствие по кнопке «Старт», кнопка «Открыть каталог» внизу,
// инструкции «Как всё работает», «Распродажа», «Доставка и оплата», канал и связь с админом.
//
// Адрес: /api/bot — сюда Telegram присылает сообщения (webhook).
// Подключить один раз после деплоя: откройте в браузере  https://<ваш сайт>/api/bot?setup=1
//   • зарегистрирует webhook, команды бота, кнопку меню «Каталог» и описание бота «Что умеет этот бот?»;
//   • если у бота уже есть webhook другого сервиса — ничего не меняет и покажет его адрес.
//     Заменить его можно так: /api/bot?setup=1&force=1
// Язык ответа: узбекский, если в Telegram у клиента узбекский; иначе русский.
import crypto from 'node:crypto';
import { json, tgApi } from '../lib/tg.mjs';

const CHANNEL = 'https://t.me/maisonforfe';
const ADMIN = 'maisonforfe1';
// Как часто выходит новый лот распродажи — поменяйте здесь, если расписание другое
const SALE_EVERY = { ru: 'Каждый час', uz: 'Har soatda' };

const site = () => (process.env.URL || '').replace(/\/$/, '');
const secret = () => crypto.createHash('sha256').update('mf-webhook:' + (process.env.BOT_TOKEN || '')).digest('hex').slice(0, 48);

const T = {
  ru: {
    welcome: () => [
      '👋 <b>Добро пожаловать в Maison Forfè!</b>',
      '',
      'Иранский фарфор в Ташкенте: сервизы, чайные и кофейные наборы, тарелки, пиалы и посуда для дома.',
      '',
      '🎁 Новым покупателям — сертификат на <b>500 000 сум</b> к заказу от 3 000 000 сум. Он уже ждёт вас в профиле каталога.',
      '',
      '🛍 Чтобы выбрать посуду, нажмите <b>«Открыть каталог»</b> — кнопка внизу экрана.',
      '🕐 Заказы принимаем <b>24/7</b>.',
      '',
      'Ниже — как всё устроено: заказ, распродажа, доставка и оплата.',
    ].join('\n'),
    how: () => [
      '📖 <b>Как сделать заказ</b>',
      '',
      '1️⃣ Нажмите <b>«Открыть каталог»</b> внизу экрана.',
      '2️⃣ Выберите посуду. Помогут поиск (можно писать и по-русски, и латиницей), категории, фильтр по цене и сортировка. Нажмите ❤️, чтобы сохранить товар в избранное.',
      '3️⃣ Откройте товар: фото можно увеличить, ниже — вещи из той же серии и похожие наборы.',
      '4️⃣ Нажмите <b>«В корзину»</b>, затем в корзине — <b>«Оформить заказ»</b>.',
      '5️⃣ Укажите имя, телефон и адрес. Сертификат применится сам, если сумма от 3 000 000 сум.',
      '6️⃣ Подтвердите заказ — он сразу придёт менеджеру.',
      '7️⃣ Менеджер свяжется с вами, уточнит детали и время доставки.',
      '',
      '🕐 Заказы принимаем <b>24/7</b> — оформить можно в любое время, даже ночью.',
      `💬 Вопросы — @${ADMIN}`,
    ].join('\n'),
    sale: () => [
      '🏷 <b>Как работает распродажа</b>',
      '',
      `🗓 <b>${SALE_EVERY.ru} — новый лот.</b> В распродажу выходит один набор посуды. Ближайшие лоты видно в каталоге: вкладка «Распродажа» → «Скоро». Анонс публикуем в канале за 5 минут до старта.`,
      '',
      '📈 <b>Цена растёт.</b> На старте лот стоит по самой низкой цене, и каждую секунду цена немного повышается, пока не дойдёт до максимальной.',
      '',
      '⚡ <b>Чем раньше — тем дешевле.</b> Лот один: кто первым нажал «Забрать», тот и купил.',
      '',
      '🔒 <b>Цена закрепляется.</b> После «Забрать» цена держится за вами 2 минуты, пока вы заполняете имя, телефон и адрес.',
      '',
      '🔔 <b>Чтобы не пропустить:</b>',
      '• «Напомнить о лоте» — бот напишет за 5 минут до старта;',
      '• «Предупредить» — бот напишет, пока цена не выросла до выбранной суммы;',
      '• «Своя цена» — предложите сумму, менеджер ответит.',
      '',
      'Доставка и оплата лотов — как у обычных заказов.',
    ].join('\n'),
    delivery: () => [
      '🚚 <b>Доставка и оплата</b>',
      '',
      '🕐 Заказы принимаем <b>24/7</b>.',
      '',
      '📍 <b>По Ташкенту</b>',
      '• Доставляем <b>на следующий день</b> после заказа.',
      '• <b>Оплата при доставке</b> — наличными или переводом, когда получите товар.',
      '• <b>Заранее ничего отправлять на карту не нужно.</b>',
      '',
      '📦 <b>По регионам Узбекистана</b>',
      '• Отправляем <b>почтой</b>.',
      '• Отправка после <b>100% оплаты</b> товара — реквизиты пришлёт менеджер после подтверждения заказа.',
      '',
      'После каждого заказа менеджер связывается с вами и уточняет детали.',
      `💬 Вопросы — @${ADMIN}`,
    ].join('\n'),
    other: () => 'Чтобы выбрать посуду, нажмите <b>«Открыть каталог»</b> внизу экрана. Ответы на частые вопросы — кнопками ниже.',
    open: '🛍 Открыть каталог', sale_btn: '🏷 Распродажа', how_btn: '📖 Как сделать заказ', sale_how: '🏷 Как работает распродажа',
    del_btn: '🚚 Доставка и оплата', chan_btn: '📣 Наш канал', admin_btn: '💬 Написать админу',
    menu: 'Каталог',
    cmds: [['start', 'Начать и открыть каталог'], ['help', 'Как сделать заказ'], ['sale', 'Как работает распродажа'], ['delivery', 'Доставка и оплата']],
    descr: 'Maison Forfè — иранский фарфор в Ташкенте.\n\n🛍 Каталог сервизов, чайных и кофейных наборов прямо в Telegram\n🏷 Распродажа: новый лот каждый час, чем раньше — тем дешевле\n🚚 По Ташкенту — на следующий день, оплата при доставке\n📦 По регионам — почтой\n🎁 Сертификат 500 000 сум новым покупателям\n\nНажмите «Старт», чтобы начать.',
    short: 'Иранский фарфор в Ташкенте. Заказы 24/7, доставка по Ташкенту на следующий день.',
  },
  uz: {
    welcome: () => [
      '👋 <b>Maison Forfè ga xush kelibsiz!</b>',
      '',
      'Toshkentda Eron chinnisi: servizlar, choy va qahva to‘plamlari, tarelkalar, piyolalar va uy uchun idishlar.',
      '',
      '🎁 Yangi xaridorlarga — 3 000 000 so‘mdan buyurtmaga <b>500 000 so‘mlik</b> sertifikat. U katalog profilida sizni kutmoqda.',
      '',
      '🛍 Idish tanlash uchun ekran pastidagi <b>«Katalogni ochish»</b> tugmasini bosing.',
      '🕐 Buyurtmalar <b>24/7</b> qabul qilinadi.',
      '',
      'Quyida — hammasi qanday ishlaydi: buyurtma, chegirmalar, yetkazib berish va to‘lov.',
    ].join('\n'),
    how: () => [
      '📖 <b>Qanday buyurtma berish</b>',
      '',
      '1️⃣ Ekran pastidagi <b>«Katalogni ochish»</b> tugmasini bosing.',
      '2️⃣ Idish tanlang: qidiruv (lotin va kirill harflarida), toifalar, narx filtri va saralash yordam beradi. ❤️ — sevimlilarga saqlash.',
      '3️⃣ Mahsulotni oching: rasmni kattalashtirish mumkin, pastda — shu seriyadagi va o‘xshash to‘plamlar.',
      '4️⃣ <b>«Savatga»</b> ni, so‘ng savatda <b>«Buyurtma berish»</b> ni bosing.',
      '5️⃣ Ism, telefon va manzilni kiriting. Summa 3 000 000 so‘mdan bo‘lsa, sertifikat o‘zi qo‘llanadi.',
      '6️⃣ Buyurtmani tasdiqlang — u darhol menejerga keladi.',
      '7️⃣ Menejer siz bilan bog‘lanib, tafsilotlar va yetkazish vaqtini aniqlaydi.',
      '',
      '🕐 Buyurtmalar <b>24/7</b> qabul qilinadi — istalgan vaqtda, hatto tunda ham.',
      `💬 Savollar — @${ADMIN}`,
    ].join('\n'),
    sale: () => [
      '🏷 <b>Chegirmalar qanday ishlaydi</b>',
      '',
      `🗓 <b>${SALE_EVERY.uz} — yangi lot.</b> Chegirmaga bitta idishlar to‘plami chiqadi. Yaqin lotlar katalogda: «Chegirmalar» → «Tez orada». E’lon kanalda startdan 5 daqiqa oldin chiqadi.`,
      '',
      '📈 <b>Narx oshib boradi.</b> Startda lot eng past narxda turadi va har soniyada narx biroz oshadi, maksimal narxga yetguncha.',
      '',
      '⚡ <b>Qancha oldin — shuncha arzon.</b> Lot bitta: «Olish»ni kim birinchi bossa, o‘sha sotib oladi.',
      '',
      '🔒 <b>Narx band qilinadi.</b> «Olish»dan keyin ism, telefon va manzilni to‘ldirguningizcha narx 2 daqiqa siz uchun saqlanadi.',
      '',
      '🔔 <b>O‘tkazib yubormaslik uchun:</b>',
      '• «Lot haqida eslatish» — bot startdan 5 daqiqa oldin yozadi;',
      '• «Ogohlantirish» — narx tanlangan summaga yetmasidan oldin bot yozadi;',
      '• «O‘z narxim» — summangizni taklif qiling, menejer javob beradi.',
      '',
      'Lotlarni yetkazish va to‘lash — oddiy buyurtmalar kabi.',
    ].join('\n'),
    delivery: () => [
      '🚚 <b>Yetkazib berish va to‘lov</b>',
      '',
      '🕐 Buyurtmalar <b>24/7</b> qabul qilinadi.',
      '',
      '📍 <b>Toshkent bo‘ylab</b>',
      '• Buyurtmadan keyin <b>ertasi kuni</b> yetkazamiz.',
      '• <b>To‘lov yetkazilganda</b> — mahsulotni olganingizda naqd yoki o‘tkazma orqali.',
      '• <b>Oldindan kartaga hech narsa yuborish shart emas.</b>',
      '',
      '📦 <b>Viloyatlarga</b>',
      '• <b>Pochta</b> orqali jo‘natamiz.',
      '• Mahsulot uchun <b>100% to‘lovdan</b> keyin jo‘natiladi — rekvizitlarni buyurtma tasdiqlangach menejer yuboradi.',
      '',
      'Har bir buyurtmadan keyin menejer siz bilan bog‘lanib, tafsilotlarni aniqlaydi.',
      `💬 Savollar — @${ADMIN}`,
    ].join('\n'),
    other: () => 'Idish tanlash uchun ekran pastidagi <b>«Katalogni ochish»</b> tugmasini bosing. Ko‘p beriladigan savollarga javoblar — quyidagi tugmalarda.',
    open: '🛍 Katalogni ochish', sale_btn: '🏷 Chegirmalar', how_btn: '📖 Qanday buyurtma berish', sale_how: '🏷 Chegirmalar qanday ishlaydi',
    del_btn: '🚚 Yetkazish va to‘lov', chan_btn: '📣 Bizning kanal', admin_btn: '💬 Adminga yozish',
    menu: 'Katalog',
    cmds: [['start', 'Boshlash va katalogni ochish'], ['help', 'Qanday buyurtma berish'], ['sale', 'Chegirmalar qanday ishlaydi'], ['delivery', 'Yetkazish va to‘lov']],
    descr: 'Maison Forfè — Toshkentda Eron chinnisi.\n\n🛍 Servizlar, choy va qahva to‘plamlari katalogi Telegramda\n🏷 Chegirmalar: har soatda yangi lot, qancha oldin — shuncha arzon\n🚚 Toshkent bo‘ylab — ertasi kuni, to‘lov yetkazilganda\n📦 Viloyatlarga — pochta orqali\n🎁 Yangi xaridorlarga 500 000 so‘mlik sertifikat\n\nBoshlash uchun «Start» ni bosing.',
    short: 'Toshkentda Eron chinnisi. Buyurtmalar 24/7, Toshkent bo‘ylab ertasi kuni yetkazish.',
  },
};

const langOf = (from) => (/^uz/i.test(from?.language_code || '') ? 'uz' : 'ru');

// Нижняя клавиатура: одна большая кнопка «Открыть каталог», всегда под полем ввода
const bottomKeyboard = (t) => ({
  keyboard: [[{ text: t.open, web_app: { url: site() } }]],
  resize_keyboard: true,
  is_persistent: true,
});

// Кнопки под сообщением: каталог, распродажа, разделы инструкции, канал, админ
function inlineMenu(t, skip) {
  const rows = [
    [{ text: t.open, web_app: { url: site() } }],
    [{ text: t.sale_btn, web_app: { url: site() + '/?go=auction' } }],
  ];
  if (skip !== 'how') rows.push([{ text: t.how_btn, callback_data: 'how' }]);
  if (skip !== 'sale') rows.push([{ text: t.sale_how, callback_data: 'sale' }]);
  if (skip !== 'delivery') rows.push([{ text: t.del_btn, callback_data: 'delivery' }]);
  rows.push([{ text: t.chan_btn, url: CHANNEL }, { text: t.admin_btn, url: `https://t.me/${ADMIN}` }]);
  return { inline_keyboard: rows };
}

const send = (chat_id, text, reply_markup) =>
  tgApi('sendMessage', { chat_id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup });

async function onMessage(m) {
  if (m.chat?.type !== 'private') return; // в группе заказов и канале бот молчит
  const t = T[langOf(m.from)];
  const cmd = String(m.text || '').trim().split(/[\s@]/)[0].toLowerCase();
  if (cmd === '/start') {
    // сначала — нижняя кнопка «Открыть каталог», затем меню с разделами
    await send(m.chat.id, t.welcome(), bottomKeyboard(t));
    await send(m.chat.id, t.how(), inlineMenu(t, 'how'));
    return;
  }
  if (cmd === '/help') return send(m.chat.id, t.how(), inlineMenu(t, 'how'));
  if (cmd === '/sale') return send(m.chat.id, t.sale(), inlineMenu(t, 'sale'));
  if (cmd === '/delivery') return send(m.chat.id, t.delivery(), inlineMenu(t, 'delivery'));
  if (m.web_app_data) return; // данные из мини-приложения не обрабатываем
  return send(m.chat.id, t.other(), inlineMenu(t));
}

async function onCallback(q) {
  const t = T[langOf(q.from)];
  await tgApi('answerCallbackQuery', { callback_query_id: q.id });
  const key = ['how', 'sale', 'delivery'].includes(q.data) ? q.data : null;
  if (!key || !q.message?.chat?.id) return;
  await send(q.message.chat.id, t[key](), inlineMenu(t, key));
}

// Разовая настройка бота: webhook, команды, кнопка меню, описание
async function setup(force) {
  if (!process.env.BOT_TOKEN) return json(500, { ok: false, error: 'Нет BOT_TOKEN в переменных Netlify' });
  if (!site()) return json(500, { ok: false, error: 'Нет переменной URL (Netlify ставит её сам после деплоя)' });
  const target = site() + '/api/bot';
  const info = await tgApi('getWebhookInfo', {});
  const current = info?.result?.url || '';
  if (current && current !== target && !force) {
    return json(409, {
      ok: false,
      error: 'У бота уже подключён другой webhook — ничего не меняли, чтобы не сломать другой сервис.',
      current,
      howToReplace: target.replace('/api/bot', '/api/bot?setup=1&force=1'),
    });
  }
  const results = {};
  results.webhook = await tgApi('setWebhook', { url: target, secret_token: secret(), allowed_updates: ['message', 'callback_query'] });
  for (const [lang, code] of [['ru', ''], ['uz', 'uz']]) {
    const t = T[lang];
    const extra = code ? { language_code: code } : {};
    results['commands_' + lang] = await tgApi('setMyCommands', { commands: t.cmds.map(([command, description]) => ({ command, description })), ...extra });
    results['description_' + lang] = await tgApi('setMyDescription', { description: t.descr, ...extra });
    results['short_' + lang] = await tgApi('setMyShortDescription', { short_description: t.short, ...extra });
  }
  // кнопка меню слева от поля ввода — «Каталог» (одна для всех языков)
  results.menu = await tgApi('setChatMenuButton', { menu_button: { type: 'web_app', text: T.ru.menu, web_app: { url: site() } } });
  const ok = Object.values(results).every((r) => r?.ok);
  return json(ok ? 200 : 500, { ok, webhook: target, previous: current || null, results });
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('setup') === '1') return setup(url.searchParams.get('force') === '1');
    return json(200, { ok: true, info: 'Maison Forfè bot webhook. Настройка: ?setup=1' });
  }
  if (req.method !== 'POST') return json(405, { ok: false });
  // принимаем только запросы от Telegram с нашим секретом
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret()) return json(403, { ok: false });
  let upd;
  try { upd = await req.json(); } catch { return json(200, { ok: true }); }
  try {
    if (upd.message) await onMessage(upd.message);
    else if (upd.callback_query) await onCallback(upd.callback_query);
  } catch (e) {
    console.error('bot update failed', e);
  }
  return json(200, { ok: true }); // всегда 200, чтобы Telegram не повторял одно и то же сообщение
};

export const config = { path: '/api/bot' };
