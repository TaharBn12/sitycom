import express from 'express';
import { supabase, must, getSetting, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, pagination, num, int, bool01, orderNumber } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';
import * as ecotrack from '../lib/ecotrack.js';

const router = express.Router();

// ── أدوات ─────────────────────────────────────────────────────
async function loadOrder(id) {
  const order = must(await supabase.from('orders').select('*').eq('id', id).maybeSingle(), 'order.get');
  if (!order) return null;
  order.items = must(await supabase.from('order_items').select('*').eq('order_id', id), 'order.items');
  order.shipment = must(
    await supabase.from('shipments').select('*').eq('order_id', id).maybeSingle(),
    'order.shipment',
  ) || null;
  order.events = must(
    await supabase.from('order_events').select('*').eq('order_id', id)
      .order('id', { ascending: false }).limit(100),
    'order.events',
  );
  return order;
}

/** يبني معاملات create/order انطلاقاً من الطلبية المحلية */
export function buildCreateParams(order, override = {}) {
  const s = order.shipment || {};
  const items = order.items || [];
  const produit = override.produit ?? s.produit ?? items.map((i) => `${i.name} x${i.qty}`).join(' / ') ?? '';
  const params = {
    reference: override.reference ?? s.reference ?? order.order_number,
    nom_client: override.nom_client ?? order.customer_name,
    telephone: override.telephone ?? order.phone,
    telephone_2: (override.telephone_2 ?? order.phone2) || undefined,
    adresse: override.adresse ?? order.address,
    code_postal: (override.code_postal ?? (order.stop_desk ? order.desk_code : '')) || undefined,
    commune: override.commune ?? order.commune,
    code_wilaya: override.code_wilaya ?? order.wilaya_id,
    montant: override.montant ?? order.total,
    remarque: (override.remarque ?? s.remarque ?? order.notes) || undefined,
    produit: produit || undefined,
    stock: bool01(override.stock ?? s.stock ?? 0),
    boutique: override.boutique ?? s.boutique ?? undefined,
    type: int(override.type ?? s.type ?? 1),
    stop_desk: bool01(override.stop_desk ?? order.stop_desk),
    weight: override.weight ?? s.weight ?? undefined,
    fragile: bool01(override.fragile ?? s.fragile ?? 0),
    gps_link: override.gps_link ?? s.gps_link ?? undefined,
    produit_a_recuperer: override.produit_a_recuperer ?? s.produit_a_recuperer ?? undefined,
  };
  if (bool01(params.stock)) {
    params.quantite = (override.quantite ?? s.quantite ?? items.map((i) => i.qty).join(',')) || '1';
  }
  const clean = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') clean[k] = v;
  return clean;
}

/** يبني معاملات update/order (أسماء حقول مختلفة!) */
export function buildUpdateParams(order, override = {}) {
  const s = order.shipment || {};
  const params = {
    tracking: override.tracking ?? s.tracking,
    reference: override.reference ?? s.reference ?? order.order_number,
    client: override.client ?? order.customer_name,
    tel: override.tel ?? order.phone,
    tel2: (override.tel2 ?? order.phone2) || undefined,
    adresse: override.adresse ?? order.address,
    code_postal: (override.code_postal ?? (order.stop_desk ? order.desk_code : '')) || undefined,
    commune: override.commune ?? order.commune,
    wilaya: override.wilaya ?? order.wilaya_id,
    montant: override.montant ?? order.total,
    remarque: (override.remarque ?? order.notes) || undefined,
    product: (override.product ?? s.produit ?? (order.items || []).map((i) => i.name).join(', ')) || undefined,
    boutique: (override.boutique ?? s.boutique) || undefined,
    type: int(override.type ?? s.type ?? 1),
    stop_desk: bool01(override.stop_desk ?? order.stop_desk),
    fragile: bool01(override.fragile ?? s.fragile ?? 0),
    gps_link: (override.gps_link ?? s.gps_link) || undefined,
  };
  const clean = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') clean[k] = v;
  return clean;
}

async function ensureShipment(orderId) {
  const existing = must(
    await supabase.from('shipments').select('id').eq('order_id', orderId).maybeSingle(),
    'shipment.find',
  );
  if (existing) return Number(existing.id);
  const row = must(
    await supabase.from('shipments')
      .insert({ order_id: orderId, type: 1, stop_desk: 0, produit: '' })
      .select('id').single(),
    'shipment.create',
  );
  return Number(row.id);
}

async function saveShipment(orderId, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const existing = must(
    await supabase.from('shipments').select('id').eq('order_id', orderId).maybeSingle(),
    'shipment.find',
  );
  if (existing) {
    must(await supabase.from('shipments').update(patch).eq('order_id', orderId), 'shipment.update');
    return;
  }
  must(
    await supabase.from('shipments').insert({ order_id: orderId, type: 1, stop_desk: 0, produit: '', ...patch }),
    'shipment.create',
  );
}

async function recordEvent(orderId, tracking, status, activity, extra = {}) {
  must(
    await supabase.from('order_events').insert({
      order_id: orderId,
      tracking: tracking || '',
      status: status || '',
      activity: activity || '',
      station: extra.station || '',
      driver: extra.driver || '',
      details: extra.details || '',
      event_date: extra.date || '',
      event_time: extra.time || '',
      created_at: now(),
    }),
    'event.insert',
  );
}

// ══════════════════════ القوائم والتفاصيل ══════════════════════
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 25, 500);
  const statuses = req.query.status && req.query.status !== 'all'
    ? String(req.query.status).split(',').filter(Boolean)
    : null;

  const data = must(
    await supabase.rpc('orders_page', {
      p_q: req.query.q ? String(req.query.q) : null,
      p_statuses: statuses && statuses.length ? statuses : null,
      p_wilaya: req.query.wilaya_id ? int(req.query.wilaya_id) : null,
      p_pushed: req.query.pushed === '1' ? 1 : req.query.pushed === '0' ? 0 : null,
      p_start: req.query.start_date ? String(req.query.start_date) : null,
      p_end: req.query.end_date ? String(req.query.end_date) : null,
      p_payment: req.query.payment_status && req.query.payment_status !== 'all' ? String(req.query.payment_status) : null,
      p_delivery: req.query.delivery === 'stopdesk' ? 1 : req.query.delivery === 'home' ? 0 : null,
      p_limit: limit,
      p_offset: offset,
    }),
    'orders.list',
  );

  const total = Number(data.total || 0);
  res.json({ ok: true, orders: data.orders, total, page, limit, pages: Math.ceil(total / limit), stats: data.stats });
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const order = await loadOrder(Number(req.params.id));
  if (!order) throw new HttpError(404, 'الطلبية غير موجودة');
  res.json({ ok: true, order, mock: await ecotrack.isMock(), order_types: ecotrack.ORDER_TYPES });
}));

// ══════════════════════ الإنشاء والتعديل ══════════════════════
async function createOrFindCustomer(orderData) {
  const phone = String(orderData.phone || '').trim();
  if (!phone) return null;
  const existing = must(
    await supabase.from('customers').select('id').eq('phone', phone).maybeSingle(),
    'order.customer.find',
  );
  if (existing) {
    must(
      await supabase.from('customers').update({
        name: orderData.customer_name,
        wilaya_id: orderData.wilaya_id || null,
        commune: orderData.commune || '',
        address: orderData.address || '',
      }).eq('id', existing.id),
      'order.customer.update',
    );
    return Number(existing.id);
  }
  const row = must(
    await supabase.from('customers').insert({
      name: orderData.customer_name,
      phone,
      phone2: orderData.phone2 || '',
      email: '',
      wilaya_id: orderData.wilaya_id || null,
      commune: orderData.commune || '',
      address: orderData.address || '',
      notes: '',
      created_at: now(),
    }).select('id').single(),
    'order.customer.create',
  );
  return Number(row.id);
}

router.post('/', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.customer_name || !b.phone) throw new HttpError(400, 'اسم الزبون ورقم الهاتف مطلوبان');
  if (!b.wilaya_id) throw new HttpError(400, 'الولاية مطلوبة');
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'أضف منتجاً واحداً على الأقل');

  const customerId = await createOrFindCustomer(b);
  const wilaya = must(
    await supabase.from('wilayas').select('*').eq('wilaya_id', int(b.wilaya_id)).maybeSingle(),
    'order.wilaya',
  );
  const orderNum = b.order_number || orderNumber();
  const stamp = now();

  const orderRow = must(
    await supabase.from('orders').insert({
      order_number: orderNum,
      customer_id: customerId,
      customer_name: b.customer_name,
      phone: String(b.phone),
      phone2: b.phone2 || '',
      wilaya_id: int(b.wilaya_id),
      wilaya_name: wilaya ? wilaya.name_fr : '',
      commune: b.commune || '',
      address: b.address || '',
      stop_desk: bool01(b.stop_desk),
      desk_code: b.desk_code || '',
      desk_name: b.desk_name || '',
      subtotal: 0,
      shipping_fee: num(b.shipping_fee),
      discount: num(b.discount),
      total: 0,
      status: 'draft',
      payment_status: 'unpaid',
      source: b.source || 'admin',
      notes: b.notes || '',
      created_at: stamp,
      updated_at: stamp,
    }).select('id').single(),
    'order.create',
  );
  const orderId = Number(orderRow.id);

  let subtotal = 0;
  for (const it of b.items) {
    const qty = Math.max(1, int(it.qty, 1));
    const price = num(it.unit_price);
    const product = it.product_id
      ? must(await supabase.from('products').select('*').eq('id', int(it.product_id)).maybeSingle(), 'order.product')
      : null;
    const name = it.name || (product ? product.name_ar : 'منتج');
    const line = price * qty;
    subtotal += line;
    must(
      await supabase.from('order_items').insert({
        order_id: orderId,
        product_id: product ? product.id : null,
        name,
        sku: product ? product.sku : (it.sku || ''),
        qty,
        unit_price: price,
        line_total: line,
      }),
      'order.item',
    );
    if (product && bool01(b.decrement_stock)) {
      must(await supabase.rpc('product_adjust_stock', { p_id: product.id, p_delta: -qty }), 'order.decrement');
    }
  }
  const total = Math.max(0, subtotal + num(b.shipping_fee) - num(b.discount));
  must(await supabase.from('orders').update({ subtotal, total }).eq('id', orderId), 'order.totals');

  // بيانات الشحن
  must(
    await supabase.from('shipments').insert({
      order_id: orderId,
      reference: b.reference || orderNum,
      type: int(b.type ?? 1),
      stop_desk: bool01(b.stop_desk),
      produit: b.produit || b.items.map((i) => `${i.name || ''} x${i.qty}`).join(' / '),
      quantite: b.quantite || b.items.map((i) => i.qty).join(','),
      stock: bool01(b.stock),
      produit_a_recuperer: b.produit_a_recuperer || '',
      boutique: b.boutique || '',
      remarque: b.remarque || b.notes || '',
      weight: num(b.weight),
      fragile: bool01(b.fragile),
      gps_link: b.gps_link || '',
      ask_collection: bool01(b.ask_collection),
    }),
    'order.shipment',
  );

  await logActivity(req.user.id, req.user.username, 'order.create', 'order', orderId, orderNum, 1);

  let pushResult = null;
  if (bool01(b.push_to_ecotrack)) {
    try {
      pushResult = await pushOrderToEcotrack(await loadOrder(orderId), req.user, bool01(b.validate_after_push));
    } catch (err) {
      pushResult = { ok: false, error: err.message, code: err.code };
    }
  }
  res.json({ ok: true, id: orderId, order: await loadOrder(orderId), push: pushResult });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const existing = must(await supabase.from('orders').select('*').eq('id', id).maybeSingle(), 'order.get');
  if (!existing) throw new HttpError(404, 'الطلبية غير موجودة');

  must(
    await supabase.from('orders').update({
      customer_name: b.customer_name ?? existing.customer_name,
      phone: b.phone ?? existing.phone,
      phone2: b.phone2 ?? existing.phone2,
      wilaya_id: int(b.wilaya_id ?? existing.wilaya_id),
      wilaya_name: b.wilaya_name ?? existing.wilaya_name,
      commune: b.commune ?? existing.commune,
      address: b.address ?? existing.address,
      stop_desk: bool01(b.stop_desk ?? existing.stop_desk),
      desk_code: b.desk_code ?? existing.desk_code,
      desk_name: b.desk_name ?? existing.desk_name,
      shipping_fee: num(b.shipping_fee ?? existing.shipping_fee),
      discount: num(b.discount ?? existing.discount),
      notes: b.notes ?? existing.notes,
      payment_status: b.payment_status ?? existing.payment_status,
      status: b.status ?? existing.status,
      updated_at: now(),
    }).eq('id', id),
    'order.update',
  );

  if (Array.isArray(b.items)) {
    must(await supabase.from('order_items').delete().eq('order_id', id), 'order.items.clear');
    let subtotal = 0;
    const rows = [];
    for (const it of b.items) {
      const qty = Math.max(1, int(it.qty, 1));
      const price = num(it.unit_price);
      subtotal += price * qty;
      rows.push({
        order_id: id,
        product_id: it.product_id ? int(it.product_id) : null,
        name: it.name || 'منتج',
        sku: it.sku || '',
        qty,
        unit_price: price,
        line_total: price * qty,
      });
    }
    if (rows.length) must(await supabase.from('order_items').insert(rows), 'order.items.insert');
    const cur = must(
      await supabase.from('orders').select('shipping_fee, discount').eq('id', id).single(),
      'order.cur',
    );
    must(
      await supabase.from('orders')
        .update({ subtotal, total: Math.max(0, subtotal + num(cur.shipping_fee) - num(cur.discount)) })
        .eq('id', id),
      'order.totals',
    );
  } else {
    const cur = must(
      await supabase.from('orders').select('subtotal, shipping_fee, discount').eq('id', id).single(),
      'order.cur',
    );
    must(
      await supabase.from('orders')
        .update({ total: Math.max(0, num(cur.subtotal) + num(cur.shipping_fee) - num(cur.discount)) })
        .eq('id', id),
      'order.total',
    );
  }

  const shipPatch = {};
  if (b.type !== undefined) shipPatch.type = int(b.type);
  if (b.boutique !== undefined) shipPatch.boutique = b.boutique;
  if (b.remarque !== undefined) shipPatch.remarque = b.remarque;
  if (b.weight !== undefined) shipPatch.weight = num(b.weight);
  if (b.fragile !== undefined) shipPatch.fragile = bool01(b.fragile);
  if (b.gps_link !== undefined) shipPatch.gps_link = b.gps_link;
  if (b.stock !== undefined) shipPatch.stock = bool01(b.stock);
  if (b.quantite !== undefined) shipPatch.quantite = b.quantite;
  if (b.produit_a_recuperer !== undefined) shipPatch.produit_a_recuperer = b.produit_a_recuperer;
  if (b.ask_collection !== undefined) shipPatch.ask_collection = bool01(b.ask_collection);
  if (b.produit !== undefined) shipPatch.produit = b.produit;
  if (Object.keys(shipPatch).length) await saveShipment(id, shipPatch);

  await logActivity(req.user.id, req.user.username, 'order.update', 'order', id, existing.order_number, 1);
  res.json({ ok: true, order: await loadOrder(id) });
}));

router.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = must(await supabase.from('orders').select('*').eq('id', id).maybeSingle(), 'order.get');
  if (!order) throw new HttpError(404, 'الطلبية غير موجودة');
  must(await supabase.from('order_events').delete().eq('order_id', id), 'order.events.delete');
  must(await supabase.from('shipments').delete().eq('order_id', id), 'order.shipment.delete');
  must(await supabase.from('order_items').delete().eq('order_id', id), 'order.items.delete');
  must(await supabase.from('orders').delete().eq('id', id), 'order.delete');
  await logActivity(req.user.id, req.user.username, 'order.delete', 'order', id, order.order_number, 1);
  res.json({ ok: true });
}));

// ══════════════════════ الربط مع Ecotrack ══════════════════════
async function pushOrderToEcotrack(order, user, validateAfter = false) {
  const params = buildCreateParams(order);
  const res = await ecotrack.createOrder(params);
  const tracking = res.data?.tracking;
  if (!tracking) throw new EcotrackPushError('لم يُرجع Ecotrack رقم تتبع', res.data);
  await saveShipment(order.id, {
    tracking,
    ecotrack_status: 'prete_a_expedier',
    pushed_at: now(),
    raw: JSON.stringify(res.data),
    produit: params.produit || '',
    quantite: params.quantite || '',
  });
  must(
    await supabase.from('orders').update({ status: 'prete_a_expedier', updated_at: now() }).eq('id', order.id),
    'order.status.push',
  );
  await recordEvent(order.id, tracking, 'prete_a_expedier', 'order_information_received_by_carrier',
    { details: 'تم إرسال الطلبية إلى Ecotrack' });
  await logActivity(user?.id, user?.username, 'ecotrack.create', 'order', order.id, tracking, 1);

  let validated = false;
  if (validateAfter) {
    const eco = (await getSetting('ecotrack', {})) || {};
    const v = await ecotrack.validOrder({ tracking, ask_collection: eco.ask_collection ? 1 : 0 });
    await saveShipment(order.id, { validated_at: now(), ask_collection: eco.ask_collection ? 1 : 0 });
    await logActivity(user?.id, user?.username, 'ecotrack.valid', 'order', order.id, tracking, 1);
    validated = Boolean(v.ok);
  }
  return { ok: true, tracking, validated, mock: Boolean(res.mock), params };
}

class EcotrackPushError extends Error {
  constructor(message, payload) { super(message); this.payload = payload; }
}

/** 3. إرسال طلبية واحدة */
router.post('/:id/push', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  if (!order) throw new HttpError(404, 'الطلبية غير موجودة');
  if (order.shipment?.tracking) throw new HttpError(409, 'هذه الطلبية مُرسلة مسبقاً برقم: ' + order.shipment.tracking);
  try {
    const result = await pushOrderToEcotrack(order, req.user, bool01(req.body?.validate));
    res.json({ ok: true, ...result, order: await loadOrder(id) });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[push]', err);
    await logActivity(req.user.id, req.user.username, 'ecotrack.create', 'order', id, err.message, 0);
    res.status(422).json({ ok: false, error: err.message, code: err.code ?? null, errors: err.errors ?? null });
  }
}));

/** 4. إرسال مجموعة (حتى 100 لكل نداء) */
router.post('/bulk-push', requireAuth, asyncRoute(async (req, res) => {
  const { ids, validate } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'اختر طلبية واحدة على الأقل');
  const cfg = (await getSetting('ecotrack', {})) || {};
  const chunkSize = 100;
  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const orders = (await Promise.all(chunk.map((id) => loadOrder(Number(id)))))
      .filter((o) => o && !o.shipment?.tracking);
    if (!orders.length) continue;
    const payloads = orders.map((o) => buildCreateParams(o));
    try {
      const r = await ecotrack.createOrdersBulk(payloads);
      const resultsMap = r.data?.results || {};
      for (let idx = 0; idx < orders.length; idx += 1) {
        const o = orders[idx];
        const key = payloads[idx].reference !== undefined ? payloads[idx].reference : String(idx);
        const entry = resultsMap[key] ?? resultsMap[String(idx)] ?? null;
        if (entry && entry.success && entry.tracking) {
          await saveShipment(o.id, { tracking: entry.tracking, ecotrack_status: 'prete_a_expedier', pushed_at: now(), raw: JSON.stringify(entry) });
          await supabase.from('orders').update({ status: 'prete_a_expedier', updated_at: now() }).eq('id', o.id);
          await recordEvent(o.id, entry.tracking, 'prete_a_expedier', 'order_information_received_by_carrier');
          if (bool01(validate)) {
            ecotrack.validOrder({ tracking: entry.tracking, ask_collection: cfg.ask_collection ? 1 : 0 })
              .then(() => saveShipment(o.id, { validated_at: now() }))
              .catch(() => {});
          }
          results.push({ id: o.id, ok: true, tracking: entry.tracking });
          success += 1;
        } else {
          const msg = entry ? flatten(entry) : 'لم تتم الاستجابة لهذه الطلبية';
          results.push({ id: o.id, ok: false, error: msg });
          failed += 1;
        }
      }
    } catch (err) {
      orders.forEach((o) => { results.push({ id: o.id, ok: false, error: err.message }); failed += 1; });
    }
  }
  await logActivity(req.user.id, req.user.username, 'ecotrack.bulk-create', 'order', '', `${success} ناجح / ${failed} فاشل`, failed === 0);
  res.json({ ok: failed === 0, success, failed, results });
}));

function flatten(entry) {
  return Object.entries(entry)
    .filter(([k]) => !['success', 'error'].includes(k))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join(' | ') || (entry.message || 'خطأ غير معروف');
}

/** 7. مصادقة وشحن */
router.post('/:id/validate', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack بعد');
  const eco = (await getSetting('ecotrack', {})) || {};
  const ask = req.body?.ask_collection !== undefined
    ? bool01(req.body.ask_collection)
    : (eco.ask_collection ? 1 : 0);
  const r = await ecotrack.validOrder({ tracking, ask_collection: ask });
  await saveShipment(id, { validated_at: now(), ask_collection: ask });
  must(await supabase.from('orders').update({ status: 'en_ramassage', updated_at: now() }).eq('id', id), 'order.status.validate');
  await recordEvent(id, tracking, 'en_ramassage', 'picked', { details: ask ? 'مع طلب الاستلام' : '' });
  await logActivity(req.user.id, req.user.username, 'ecotrack.valid', 'order', id, tracking, 1);
  res.json({ ok: true, data: r.data, order: await loadOrder(id) });
}));

/** 5. تعديل الطلبية عند Ecotrack */
router.post('/:id/update-ecotrack', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  if (!order?.shipment?.tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const params = req.body?.sync_from_local
    ? buildUpdateParams(order)
    : buildUpdateParams(order, req.body?.fields || {});
  const r = await ecotrack.updateOrder(params);
  await logActivity(req.user.id, req.user.username, 'ecotrack.update', 'order', id, params.tracking, 1);
  res.json({ ok: true, data: r.data, params });
}));

/** 6. حذف الطلبية من Ecotrack */
router.delete('/:id/ecotrack', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  if (!order?.shipment?.tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const r = await ecotrack.deleteOrder(order.shipment.tracking);
  await saveShipment(id, { tracking: '', ecotrack_status: '', pushed_at: null, validated_at: null, raw: null });
  must(await supabase.from('orders').update({ status: 'draft', updated_at: now() }).eq('id', id), 'order.status.unpush');
  await logActivity(req.user.id, req.user.username, 'ecotrack.delete', 'order', id, order.shipment.tracking, 1);
  res.json({ ok: true, data: r.data, order: await loadOrder(id) });
}));

/** 9. ملصق الشحن PDF */
router.get('/:id/label', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'لا يوجد رقم تتبع لهذه الطلبية');
  const r = await ecotrack.getOrderLabel(tracking);
  const download = req.query.download === '1';
  res.setHeader('Content-Type', r.contentType || 'application/pdf');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="label-${tracking}.pdf"`);
  res.send(r.buffer);
}));

/** 10. إضافة ملاحظة (maj) */
router.post('/:id/maj', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  const tracking = order?.shipment?.tracking || req.body?.tracking;
  const content = String(req.body?.content || '').trim();
  if (!tracking) throw new HttpError(400, 'لا يوجد رقم تتبع');
  if (!content) throw new HttpError(400, 'نص الملاحظة مطلوب');
  const r = await ecotrack.addMaj({ tracking, content });
  await recordEvent(id, tracking, order?.shipment?.ecotrack_status || '', 'notification_on_order', { details: content });
  await logActivity(req.user.id, req.user.username, 'ecotrack.addMaj', 'order', id, tracking, 1);
  res.json({ ok: true, data: r.data });
}));

/** 11. قراءة الملاحظات */
router.get('/:id/maj', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'لا يوجد رقم تتبع');
  const r = await ecotrack.getMaj(tracking);
  res.json({ ok: true, data: r.data });
}));

/** 12. طلب إرجاع */
router.post('/:id/ask-return', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  if (!order?.shipment?.tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const r = await ecotrack.askForOrderReturn(order.shipment.tracking);
  await saveShipment(id, { return_asked_at: now() });
  await recordEvent(id, order.shipment.tracking, 'retour_en_traitement', 'return_asked');
  await logActivity(req.user.id, req.user.username, 'ecotrack.askReturn', 'order', id, order.shipment.tracking, 1);
  res.json({ ok: true, data: r.data, order: await loadOrder(id) });
}));

/** 13. مزامنة حالة طلبية واحدة */
router.post('/:id/sync', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = await loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const r = await ecotrack.getTrackingInfo(tracking);
  const info = r.data || {};
  const activity = Array.isArray(info.activity) ? info.activity : [];
  const last = activity[activity.length - 1];
  const status = info.status || last?.status || order.shipment.ecotrack_status || '';

  await saveShipment(id, {
    ecotrack_status: typeof status === 'string' && isActivityKey(status) ? mapActivityToStatus(status) : (info.status || status),
    last_activity: last?.status || '',
    last_activity_at: last ? `${last.date || ''} ${last.time || ''}`.trim() : '',
    synced_at: now(),
    raw: JSON.stringify(info),
  });
  must(
    await supabase.from('order_events').delete().eq('order_id', id).eq('tracking', tracking),
    'order.events.clear',
  );
  for (const a of activity) {
    await recordEvent(id, tracking, mapActivityToStatus(a.status), a.status,
      { station: a.station || a.scanLocation || '', date: a.date || '', time: a.time || '' });
  }
  const localStatus = statusToLocal(status);
  if (localStatus) {
    must(await supabase.from('orders').update({ status: localStatus, updated_at: now() }).eq('id', id), 'order.status.sync');
  }
  res.json({ ok: true, data: info, order: await loadOrder(id) });
}));

function isActivityKey(s) {
  return ecotrack.ACTIVITIES.includes(String(s));
}

export function mapActivityToStatus(activity) {
  const map = {
    order_information_received_by_carrier: 'prete_a_expedier',
    notification_on_order: 'en_preparation',
    picked: 'en_ramassage',
    accepted_by_carrier: 'en_hub',
    dispatched_to_driver: 'en_livraison',
    attempt_delivery: 'en_livraison',
    return_asked: 'retour_chez_livreur',
    return_in_transit: 'retour_transit_entrepot',
    Return_received: 'retour_recu',
    livred: 'livre_non_encaisse',
    encaissed: 'encaisse_non_paye',
    payed: 'paye_et_archive',
  };
  return map[activity] || activity;
}

function statusToLocal(status) {
  if (ecotrack.ECOTRACK_STATUSES.includes(String(status))) return status;
  return null;
}

/** 14/16. مزامنة حالة مجموعة طلبيات */
router.post('/sync-status', requireAuth, asyncRoute(async (req, res) => {
  const { ids, mode = 'status' } = req.body || {};
  let trackings = [];
  if (Array.isArray(ids) && ids.length) {
    trackings = must(
      await supabase.from('shipments').select('order_id, tracking')
        .in('order_id', ids.map(Number))
        .not('tracking', 'is', null)
        .neq('tracking', ''),
      'sync.tracking.ids',
    );
  } else {
    trackings = must(
      await supabase.from('shipments').select('order_id, tracking')
        .not('tracking', 'is', null)
        .neq('tracking', '')
        .order('order_id', { ascending: false })
        .limit(100),
      'sync.tracking.latest',
    );
  }
  if (!trackings.length) throw new HttpError(400, 'لا توجد طلبيات مُرسلة للمزامنة');

  const byTracking = new Map(trackings.map((t) => [t.tracking, t.order_id]));
  const list = [...byTracking.keys()];
  let updated = 0;
  const errors = [];

  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    try {
      const r = mode === 'tracking'
        ? await ecotrack.getTrackingsInfo(chunk)
        : await ecotrack.getOrdersStatus({ trackings: chunk, status: 'all' });
      const payload = r.data || {};
      const entries = mode === 'tracking' ? (Array.isArray(payload) ? payload : []) : Object.values(payload.data || {});

      for (const entry of entries) {
        const tracking = entry.tracking || entry.Tracking;
        const orderId = byTracking.get(tracking);
        if (!orderId) continue;
        const activity = Array.isArray(entry.activity) ? entry.activity : [];
        const last = activity[activity.length - 1];
        const status = entry.status || last?.status || '';
        const localStatus = isActivityKey(status) ? mapActivityToStatus(status) : status;
        await saveShipment(orderId, {
          ecotrack_status: ecotrack.ECOTRACK_STATUSES.includes(localStatus) ? localStatus : localStatus,
          last_activity: last?.status || '',
          last_activity_at: last ? `${last.date || ''} ${last.time || ''}`.trim() : '',
          synced_at: now(),
          raw: JSON.stringify(entry),
        });
        if (ecotrack.ECOTRACK_STATUSES.includes(localStatus)) {
          await supabase.from('orders').update({ status: localStatus, updated_at: now() }).eq('id', orderId);
        }
        if (activity.length) {
          must(
            await supabase.from('order_events').delete().eq('order_id', orderId).eq('tracking', tracking),
            'sync.events.clear',
          );
          for (const a of activity) {
            await recordEvent(orderId, tracking, mapActivityToStatus(a.status), a.status,
              { station: a.station || '', driver: a.driver || '', details: a.details || a.reason || '', date: a.date || '', time: a.time || '' });
          }
        }
        updated += 1;
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  await logActivity(req.user.id, req.user.username, 'ecotrack.syncStatus', 'order', '', `${updated} طلبية`, errors.length === 0);
  res.json({ ok: errors.length === 0, updated, errors });
}));

/** سحب طلبيات Ecotrack إلى المحلي (15. get/orders) */
router.post('/import-ecotrack', requireAuth, asyncRoute(async (req, res) => {
  const { pages = 1, start_date, end_date } = req.body || {};
  let imported = 0;
  let updated = 0;
  const errors = [];
  for (let p = 1; p <= Math.min(20, Number(pages) || 1); p += 1) {
    let r;
    try {
      r = await ecotrack.getOrders({ page: p, start_date, end_date });
    } catch (err) { errors.push(err.message); break; }
    const rows = r.data?.data || (Array.isArray(r.data) ? r.data : []);
    for (const row of rows) {
      const tracking = row.tracking;
      if (!tracking) continue;
      const exists = must(
        await supabase.from('shipments').select('order_id').eq('tracking', tracking).maybeSingle(),
        'import.find',
      );
      if (exists) {
        await saveShipment(exists.order_id, {
          ecotrack_status: row.status || '',
          last_activity: '',
          synced_at: now(),
          raw: JSON.stringify(row),
        });
        await supabase.from('orders')
          .update({ status: row.status || 'prete_a_expedier', updated_at: now() })
          .eq('id', exists.order_id);
        updated += 1;
        continue;
      }
      const wilayaId = num(row.wilaya_id, 0) || null;
      const wilaya = wilayaId
        ? must(await supabase.from('wilayas').select('name_fr').eq('wilaya_id', wilayaId).maybeSingle(), 'import.wilaya')
        : null;
      let orderNum = row.reference || `ECO-${tracking}`;
      const numExists = must(
        await supabase.from('orders').select('id').eq('order_number', orderNum).maybeSingle(),
        'import.numcheck',
      );
      if (numExists) {
        orderNum = `${orderNum}-${tracking}`;
      }
      const stamp = now();
      const orderRow = must(
        await supabase.from('orders').insert({
          order_number: orderNum,
          customer_id: null,
          customer_name: row.client || 'عميل Ecotrack',
          phone: String(row.phone || ''),
          phone2: String(row.phone_2 || ''),
          wilaya_id: wilayaId,
          wilaya_name: wilaya ? wilaya.name_fr : '',
          commune: row.commune || '',
          address: row.adresse || '',
          stop_desk: 0,
          subtotal: num(row.montant) - num(row.tarif_prestation),
          shipping_fee: num(row.tarif_prestation),
          discount: 0,
          total: num(row.montant),
          status: row.status || 'prete_a_expedier',
          payment_status: ['encaisse_non_paye', 'paiements_prets', 'paye_et_archive'].includes(row.status) ? 'collected' : 'unpaid',
          source: 'ecotrack',
          notes: `مستوردة من Ecotrack (${tracking})`,
          created_at: stamp,
          updated_at: stamp,
        }).select('id').single(),
        'import.order',
      );
      const orderId = Number(orderRow.id);
      must(
        await supabase.from('order_items').insert({
          order_id: orderId,
          product_id: null,
          name: row.products || 'منتج',
          sku: '',
          qty: 1,
          unit_price: num(row.montant) - num(row.tarif_prestation),
          line_total: num(row.montant) - num(row.tarif_prestation),
        }),
        'import.item',
      );
      must(
        await supabase.from('shipments').insert({
          order_id: orderId,
          tracking,
          reference: orderNum,
          type: num(row.type_id, 1),
          stop_desk: 0,
          produit: row.products || '',
          ecotrack_status: row.status || '',
          delivery_fee: num(row.tarif_prestation),
          pushed_at: now(),
          synced_at: now(),
          raw: JSON.stringify(row),
        }),
        'import.shipment',
      );
      imported += 1;
    }
  }
  await logActivity(req.user.id, req.user.username, 'ecotrack.import', 'order', '', `${imported} جديدة / ${updated} محدّثة`, errors.length === 0);
  res.json({ ok: errors.length === 0, imported, updated, errors });
}));

/** حساب سعر التوصيل المحفوظ محلياً */
router.post('/quote', requireAuth, asyncRoute(async (req, res) => {
  const { wilaya_id, stop_desk = 0, type = 1 } = req.body || {};
  const fee = must(
    await supabase.from('shipping_fees').select('*').eq('wilaya_id', int(wilaya_id)).maybeSingle(),
    'quote.fee',
  );
  if (!fee) return res.json({ ok: true, found: false, fee: 0 });
  const desk = bool01(stop_desk);
  const t = int(type, 1);
  let value = 0;
  if (t === 1) value = desk ? fee.delivery_stopdesk : fee.delivery_home;
  else if (t === 2) value = desk ? fee.exchange_stopdesk : fee.exchange_home;
  else if (t === 3) value = desk ? fee.pickup_stopdesk : fee.pickup_home;
  else value = desk ? fee.collection_stopdesk : fee.collection_home;
  res.json({
    ok: true, found: true, fee: value,
    return_fee: desk ? fee.return_stopdesk : fee.return_home,
    wilaya: fee.wilaya_name,
  });
}));

export default router;
