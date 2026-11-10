// Аукцион: состояние лота, бронь цены, покупка, предложения цены, напоминания и админ-управление.
// Все действия — POST /api/auction с полем action. Управлять лотами могут только ADMIN_IDS.
import { getStore } from '@netlify/blobs';
import { json, verifyInitData, STORE_NAME, tgSend, isAdmin, ADMIN_IDS, sum } from '../lib/tg.mjs';
import { HOLD_MS, HOLD_LIMIT, HOLD_WINDOW_MS, norm, priceAt } from '../lib/auction.mjs';
import { channelNow, appBase } from '../lib/channel.mjs';
import { recordOrder } from '../lib/stats.mjs';

// «Смотрят сейчас»: открытое приложение отмечается раз в ~20 секунд, считаем последние 30–60 секунд.
const SEEN_MS = 30000;
async function viewers(s, lotId, uid, watch, now) {
  const bucket = Math.floor(now / SEEN_MS);
  if (uid && watch) await s.set(`seen/${lotId}/${bucket}/${uid}`, '1').catch(() => {});
  const ids = new Set();
  for (const b of [bucket, bucket - 1]) {
    const { blobs } = await s.list({ prefix: `seen/${lotId}/${b}/` }).catch(() => ({ blobs: [] }));
    for (const x of blobs) ids.add(x.key.split('/').pop());
  }
  return ids.size;
}

const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

async function loadLots(s) {
  const { blobs } = await s.list({ prefix: 'lot/' });
  const lots = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' }).catch(() => null)));
  return lots.filter(Boolean).sort((a, b) => a.startAt - b.startAt);
}

async function updateLot(s, id, fn) {
  for (let i = 0; i < 5; i++) {
    const cur = await s.getWithMetadata('lot/' + id, { type: 'json' });
    if (!cur) return { err: 'not_found' };
    const lot = norm(cur.data, Date.now());
    const r = fn(lot) || {};
    if (r.err) return r;
    const w = await s.setJSON('lot/' + id, lot, { onlyIfMatch: cur.etag });
    if (w.modified) return { ...r, lot };
  }
  return { err: 'busy' };
}

async function addToList(s, key, value, max = 2000) {
  for (let i = 0; i < 5; i++) {
    const cur = await s.getWithMetadata(key, { type: 'json' });
    const list = cur && Array.isArray(cur.data) ? cur.data : [];
    if (list.includes(value)) return true;
    const next = [...list, value].slice(-max);
    const w = await s.setJSON(key, next, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (w.modified) return true;
  }
  return false;
}

async function addToFeed(s, id) {
  for (let i = 0; i < 4; i++) {
    const cur = await s.getWithMetadata('feed', { type: 'json' });
    const prev = cur && Array.isArray(cur.data) ? cur.data : [];
    const w = await s.setJSON('feed', [{ id, at: Date.now() }, ...prev].slice(0, 30), cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (w.modified) return;
  }
}

function publicView(lot, now, uid) {
  const p = priceAt(lot, now);
  return {
    id: lot.id, itemId: lot.itemId, itemName: lot.itemName, start: lot.start, min: lot.min,
    startAt: lot.startAt, durationMin: lot.durationMin, catalogPrice: lot.catalogPrice || 0, stepMin: lot.stepMin, paused: lot.paused || 0,
    hold: lot.hold ? { since: lot.hold.since, until: lot.hold.until, mine: lot.hold.uid === uid, price: lot.hold.uid === uid ? lot.hold.price : undefined } : null,
    status: lot.status, phase: p.phase, price: p.price,
    sold: lot.sold ? { price: lot.sold.price, at: lot.sold.at, mine: lot.sold.uid === uid } : null,
    alert: uid ? ((lot.alerts || []).find((a) => a.uid === uid && !a.sent) || {}).price || null : null,
  };
}

const orderNo = () => {
  const d = new Date();
  return 'MF-A' + String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0') + '-' + String(Date.now()).slice(-4);
};
const who = (u) => (u.username ? '@' + u.username + ' ' : '') + `(ID ${u.id})`;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false });
  let body;
  try { body = await req.json(); } catch { return json(400, { ok: false }); }
  const user = verifyInitData(body?.initData, process.env.BOT_TOKEN);
  const uid = user ? user.id : null;
  const action = str(body?.action, 30);
  const s = store();
  const now = Date.now();

  // ---------- для всех ----------
  if (action === 'state') {
    const lots = (await loadLots(s)).map((l) => norm(l, now));
    const views = lots.map((l) => publicView(l, now, uid));
    const current = views.find((v) => v.phase === 'live' || v.phase === 'held') || null;
    const next = views.filter((v) => v.phase === 'scheduled').sort((a, b) => a.startAt - b.startAt)[0] || null;
    const recentSold = views.filter((v) => v.phase === 'sold' && v.sold && now - v.sold.at < 60 * 60000).sort((a, b) => b.sold.at - a.sold.at)[0] || null;
    const upcoming = views.filter((v) => v.phase === 'scheduled').sort((a, b) => a.startAt - b.startAt).slice(0, 10);
    const sales = views.filter((v) => v.phase === 'sold' && v.sold).sort((a, b) => b.sold.at - a.sold.at).slice(0, 8)
      .map((v) => ({ id: v.id, itemId: v.itemId, itemName: v.itemName, price: v.sold.price, at: v.sold.at, mine: v.sold.mine }));
    const watching = current ? await viewers(s, current.id, uid, !!body.watch, now) : 0;
    const link = await appBase().catch(() => '');
    return json(200, { ok: true, now, current, next, upcoming, sales, recentSold, watching, appLink: link, holdMs: HOLD_MS }, { 'Cache-Control': 'no-store' });
  }

  if (!user) return json(403, { ok: false, error: 'not_telegram' });

  if (action === 'hold') {
    const id = str(body.id, 40);
    const r = await updateLot(s, id, (lot) => {
      const p = priceAt(lot, now);
      if (lot.hold && lot.hold.uid === uid && p.phase === 'held') return { price: lot.hold.price, until: lot.hold.until };
      if (p.phase === 'held') return { err: 'held' };
      if (p.phase !== 'live') return { err: p.phase };
      // не больше HOLD_LIMIT нажатий «Купить» за HOLD_WINDOW_MS (защита от «нажал — закрыл»)
      lot.holds = lot.holds || {};
      const tries = (Array.isArray(lot.holds[uid]) ? lot.holds[uid] : []).filter((t) => now - t < HOLD_WINDOW_MS);
      if (tries.length >= HOLD_LIMIT) return { err: 'too_many', retryIn: tries[0] + HOLD_WINDOW_MS - now };
      tries.push(now);
      lot.holds[uid] = tries;
      lot.hold = { uid, since: now, until: now + HOLD_MS, price: p.price };
      return { price: p.price, until: now + HOLD_MS };
    });
    if (r.err) return json(200, { ok: false, error: r.err, retryIn: r.retryIn || 0 });
    return json(200, { ok: true, price: r.price, until: r.until, now });
  }

  if (action === 'release') {
    const id = str(body.id, 40);
    await updateLot(s, id, (lot) => {
      if (!lot.hold || lot.hold.uid !== uid) return { err: 'no_hold' };
      lot.paused = (lot.paused || 0) + (now - lot.hold.since);
      lot.hold = null;
      return {};
    });
    return json(200, { ok: true });
  }

  if (action === 'buy') {
    const id = str(body.id, 40);
    const f = body.form || {};
    const form = { name: str(f.name, 80), phone: str(f.phone, 30), addr: str(f.addr, 300), comment: str(f.comment, 300) };
    if (!form.name || !form.phone || !form.addr) return json(400, { ok: false, error: 'form' });
    const no = orderNo();
    let snapshot = null;
    const r = await updateLot(s, id, (lot) => {
      if (!lot.hold || lot.hold.uid !== uid || lot.hold.until <= now || lot.status !== 'active') return { err: 'expired' };
      snapshot = JSON.parse(JSON.stringify(lot));
      lot.status = 'sold';
      lot.sold = { uid, price: lot.hold.price, at: now, order: no, via: 'buy', ...form, username: user.username || '' };
      lot.hold = null;
      return { price: lot.sold.price };
    });
    if (r.err) return json(200, { ok: false, error: r.err });
    const lot = r.lot;
    const text = [
      `🔨 Аукцион: заказ ${no} — Maison Forfe`, '',
      `• ${lot.itemName} — 1 шт.`,
      `Цена на аукционе: ${sum(r.price)} (старт ${sum(lot.start)}, минимум ${sum(lot.min)})`, '',
      `Итого к оплате: ${sum(r.price)}`, '',
      `Имя: ${form.name}`, `Телефон: ${form.phone}`, `Адрес: ${form.addr}`,
      ...(form.comment ? [`Комментарий: ${form.comment}`] : []), '',
      `✅ Подтверждено Telegram: ${who(user)}`,
    ].join('\n');
    const sent = await tgSend(process.env.ORDER_CHAT_ID, text);
    if (!sent) {
      // заказ не ушёл — возвращаем лот покупателю, чтобы он мог повторить
      await s.setJSON('lot/' + id, { ...snapshot, hold: { ...snapshot.hold, until: Date.now() + 2 * 60000 } }).catch(() => {});
      return json(502, { ok: false, error: 'telegram' });
    }
    if (!/т[еe]ст|test/i.test(form.comment)) {
      await addToFeed(s, lot.itemId).catch(() => {});
      await recordOrder(s, { items: [[lot.itemId, 1]], total: r.price, source: 'auction' }).catch((e) => console.error('stats failed', e));
    }
    await channelNow(lot);
    return json(200, { ok: true, no, price: r.price });
  }

  if (action === 'offer') {
    const id = str(body.id, 40);
    const price = Math.round(Number(body.price) || 0);
    const phone = str(body.phone, 30);
    const name = str(body.name, 80);
    if (price <= 0 || !phone) return json(400, { ok: false, error: 'form' });
    let lotName = '';
    const r = await updateLot(s, id, (lot) => {
      const p = priceAt(lot, now);
      if (!['live', 'held'].includes(p.phase)) return { err: p.phase === 'scheduled' ? 'not_started' : p.phase };
      if (price < (lot.floor || lot.min)) return { err: 'low' };
      if (price >= p.price && p.phase === 'live') return { err: 'buy_instead' };
      lot.offers = (lot.offers || []).filter((o) => o.uid !== uid);
      lot.offers.push({ uid, username: user.username || '', name, phone, price, at: now, status: 'new' });
      lot.offers = lot.offers.slice(-50);
      lotName = lot.itemName;
      return {};
    });
    if (r.err) return json(200, { ok: false, error: r.err });
    const msg = `💬 Предложение цены на аукционе\n\nЛот: ${lotName}\nПредложение: ${sum(price)}\nОт: ${name || '—'} ${who(user)}\nТелефон: ${phone}\n\nРешение — в мини-аппе: Профиль → Управление аукционом.`;
    await Promise.all(ADMIN_IDS.map((a) => tgSend(a, msg)));
    return json(200, { ok: true });
  }

  if (action === 'alert') {
    // «Сообщить, когда цена опустится до…»
    const id = str(body.id, 40);
    const price = Math.round(Number(body.price) || 0);
    const r = await updateLot(s, id, (lot) => {
      const p = priceAt(lot, now);
      if (!['live', 'held', 'scheduled'].includes(p.phase)) return { err: p.phase };
      if (price < lot.min) return { err: 'below_min' };
      if (price >= p.price) return { err: 'above_now' };
      lot.alerts = (lot.alerts || []).filter((a) => a.uid !== uid);
      lot.alerts.push({ uid, price, at: now, sent: false });
      lot.alerts = lot.alerts.slice(-500);
      return {};
    });
    return json(200, r.err ? { ok: false, error: r.err } : { ok: true });
  }

  if (action === 'remind') {
    const id = str(body.id, 40) || 'next';
    const ok = await addToList(s, 'remind/' + id, uid);
    return json(200, { ok });
  }

  // ---------- только владелец ----------
  if (!isAdmin(user)) return json(403, { ok: false, error: 'not_admin' });

  if (action === 'admin_list') {
    const lots = (await loadLots(s)).map((l) => norm(l, now)).map((l) => ({ ...l, phase: priceAt(l, now).phase, price: priceAt(l, now).price }));
    return json(200, { ok: true, now, lots: lots.slice(-40) }, { 'Cache-Control': 'no-store' });
  }

  if (action === 'admin_create') {
    const l = body.lot || {};
    const lot = {
      id: 'L' + now.toString(36),
      itemId: str(l.itemId, 40), itemName: str(l.itemName, 120), photo: str(l.photo, 160), catalogPrice: Math.round(Number(l.catalogPrice) || 0), alerts: [],
      start: Math.round(Number(l.start) || 0), min: Math.round(Number(l.min) || 0), floor: Math.round(Number(l.floor) || 0),
      startAt: Math.round(Number(l.startAt) || 0), durationMin: Math.round(Number(l.durationMin) || 30), stepMin: Math.round(Number(l.stepMin) || 1),
      status: 'active', paused: 0, hold: null, offers: [], createdAt: now,
    };
    if (!lot.itemId || !lot.itemName) return json(400, { ok: false, error: 'Выберите набор' });
    if (!(lot.start > lot.min && lot.min > 0)) return json(400, { ok: false, error: 'Старт должен быть больше минимума' });
    if (!lot.floor) lot.floor = lot.min;
    if (lot.floor > lot.start) return json(400, { ok: false, error: 'Порог предложений не может быть выше старта' });
    if (lot.durationMin < 5 || lot.durationMin > 24 * 60) return json(400, { ok: false, error: 'Длительность от 5 минут до 24 часов' });
    if (!lot.startAt || lot.startAt < now - 60000) return json(400, { ok: false, error: 'Время старта уже прошло' });
    const clash = (await loadLots(s)).find((x) => x.status === 'active' && priceAt(norm(x, now), now).phase !== 'ended' &&
      lot.startAt < x.startAt + (x.paused || 0) + x.durationMin * 60000 && x.startAt < lot.startAt + lot.durationMin * 60000);
    if (clash) return json(400, { ok: false, error: `Пересекается с лотом «${clash.itemName}»` });
    await s.setJSON('lot/' + lot.id, lot, { onlyIfNew: true });
    return json(200, { ok: true, lot });
  }

  if (action === 'admin_clear') {
    // удаляет завершённые лоты: проданные, отменённые и закончившиеся без продажи
    let removed = 0;
    for (const l of await loadLots(s)) {
      const ph = priceAt(norm(l, now), now).phase;
      if (['sold', 'ended', 'cancelled'].includes(ph)) {
        await s.delete('lot/' + l.id).catch(() => {});
        await s.delete('remind/' + l.id).catch(() => {});
        await s.delete('remindDone/' + l.id).catch(() => {});
        removed++;
      }
    }
    return json(200, { ok: true, removed });
  }

  if (action === 'admin_cancel') {
    const r = await updateLot(s, str(body.id, 40), (lot) => {
      if (lot.status !== 'active') return { err: 'not_active' };
      lot.status = 'cancelled';
      lot.hold = null;
      return {};
    });
    if (!r.err) await channelNow(r.lot);
    return json(200, r.err ? { ok: false, error: r.err } : { ok: true });
  }

  if (action === 'admin_offer') {
    const id = str(body.id, 40);
    const ouid = Number(body.uid);
    const accept = body.decision === 'accept';
    const no = orderNo();
    let offer = null;
    const r = await updateLot(s, id, (lot) => {
      offer = (lot.offers || []).find((o) => o.uid === ouid && o.status === 'new');
      if (!offer) return { err: 'no_offer' };
      if (accept) {
        if (lot.status !== 'active') return { err: 'not_active' };
        lot.status = 'sold';
        lot.hold = null;
        lot.sold = { uid: ouid, price: offer.price, at: now, order: no, via: 'offer', name: offer.name, phone: offer.phone, username: offer.username };
        offer.status = 'accepted';
      } else {
        offer.status = 'declined';
      }
      return {};
    });
    if (r.err) return json(200, { ok: false, error: r.err });
    const lot = r.lot;
    if (accept) {
      await tgSend(process.env.ORDER_CHAT_ID, [
        `🔨 Аукцион: принято предложение ${no} — Maison Forfe`, '',
        `• ${lot.itemName} — 1 шт.`, `Цена по предложению: ${sum(offer.price)}`, '',
        `Имя: ${offer.name || '—'}`, `Телефон: ${offer.phone}`, `Telegram: ${offer.username ? '@' + offer.username + ' ' : ''}(ID ${offer.uid})`, '',
        'Адрес уточните при звонке.',
      ].join('\n'));
      await tgSend(ouid, `🎉 Ваше предложение ${sum(offer.price)} за «${lot.itemName}» принято! Менеджер свяжется с вами в течение рабочего дня.`);
      await addToFeed(s, lot.itemId).catch(() => {});
      await channelNow(lot);
    } else {
      await tgSend(ouid, `К сожалению, предложение ${sum(offer.price)} за «${lot.itemName}» не принято. Следите за новыми лотами в каталоге Maison Forfè.`);
    }
    return json(200, { ok: true });
  }

  return json(400, { ok: false, error: 'unknown_action' });
};

export const config = { path: '/api/auction' };
