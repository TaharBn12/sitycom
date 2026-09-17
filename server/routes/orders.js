import express from 'express';
import { get, run, all, getSetting, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, pagination, num, int, bool01, orderNumber } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';
import * as ecotrack from '../lib/ecotrack.js';

const router = express.Router();

// ── أدوات ─────────────────────────────────────────────────────
function loadOrder(id) {
  const order = get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) return null;
  order.items = all('SELECT * FROM order_items WHERE order_id = ?', [id]);
  order.shipment = get('SELECT * FROM shipments WHERE order_id = ?', [id]) || null;
  order.events = all('SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 100', [id]);
  return order;
}

function recalcTotals(order) {
  const subtotal = (order.items || []).reduce((s, it) => s + num(it.line_total), 0);
  const total = Math.max(0, subtotal + num(order.shipping_fee) - num(order.discount));
  return { subtotal, total };
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

function ensureShipment(orderId) {
  const existing = get('SELECT * FROM shipments WHERE order_id = ?', [orderId]);
  if (existing) return Number(existing.id);
  const info = run(
    "INSERT INTO shipments (order_id, type, stop_desk, produit) VALUES (?, 1, 0, '')",
    [orderId],
  );
  return Number(info.lastInsertRowid);
}

function saveShipment(orderId, patch) {
  ensureShipment(orderId);
  const keys = Object.keys(patch);
  if (!keys.length) return;
  run(`UPDATE shipments SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE order_id = ?`,
    [...keys.map((k) => patch[k]), orderId]);
}

function recordEvent(orderId, tracking, status, activity, extra = {}) {
  run(
    `INSERT INTO order_events (order_id, tracking, status, activity, station, driver, details, event_date, event_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderId, tracking || '', status || '', activity || '', extra.station || '', extra.driver || '',
      extra.details || '', extra.date || '', extra.time || '', now()],
  );
}

// ══════════════════════ القوائم والتفاصيل ══════════════════════
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 25, 500);
  const where = [];
  const params = [];
  const q = req.query.q;
  if (q) {
    where.push('(LOWER(o.order_number) LIKE ? OR LOWER(o.customer_name) LIKE ? OR o.phone LIKE ? OR s.tracking LIKE ? OR s.reference LIKE ?)');
    const like = `%${String(q).toLowerCase()}%`;
    params.push(like, like, like, like, like);
  }
  if (req.query.status && req.query.status !== 'all') {
    const statuses = String(req.query.status).split(',').filter(Boolean);
    where.push(`(o.status IN (${statuses.map(() => '?').join(',')}) OR s.ecotrack_status IN (${statuses.map(() => '?').join(',')}))`);
    params.push(...statuses, ...statuses);
  }
  if (req.query.wilaya_id) { where.push('o.wilaya_id = ?'); params.push(int(req.query.wilaya_id)); }
  if (req.query.pushed === '1') where.push("s.tracking IS NOT NULL AND s.tracking != ''");
  if (req.query.pushed === '0') where.push("(s.tracking IS NULL OR s.tracking = '')");
  if (req.query.start_date) { where.push('date(o.created_at) >= ?'); params.push(String(req.query.start_date)); }
  if (req.query.end_date) { where.push('date(o.created_at) <= ?'); params.push(String(req.query.end_date)); }
  if (req.query.payment_status && req.query.payment_status !== 'all') {
    where.push('o.payment_status = ?'); params.push(String(req.query.payment_status));
  }
  if (req.query.delivery === 'stopdesk') where.push('o.stop_desk = 1');
  if (req.query.delivery === 'home') where.push('o.stop_desk = 0');

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT o.*, s.tracking, s.ecotrack_status, s.type AS ship_type, s.pushed_at, s.validated_at,
       s.return_asked_at, s.last_activity, s.last_activity_at,
       (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
     FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
     ${w} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const total = Number(get(
    `SELECT COUNT(*) AS c FROM orders o LEFT JOIN shipments s ON s.order_id = o.id ${w}`, params)?.c || 0);

  const stats = all(
    `SELECT COALESCE(s.ecotrack_status, o.status) AS st, COUNT(*) AS c
     FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
     GROUP BY st ORDER BY c DESC`);

  res.json({ ok: true, orders: rows, total, page, limit, pages: Math.ceil(total / limit), stats });
}));

router.get('/:id', requireAuth, asyncRoute(async (req, res) => {
  const order = loadOrder(Number(req.params.id));
  if (!order) throw new HttpError(404, 'الطلبية غير موجودة');
  res.json({ ok: true, order, mock: ecotrack.isMock(), order_types: ecotrack.ORDER_TYPES });
}));

// ══════════════════════ الإنشاء والتعديل ══════════════════════
function createOrFindCustomer(orderData) {
  const phone = String(orderData.phone || '').trim();
  if (!phone) return null;
  const existing = get('SELECT id FROM customers WHERE phone = ?', [phone]);
  if (existing) {
    run('UPDATE customers SET name = ?, wilaya_id = ?, commune = ?, address = ? WHERE id = ?',
      [orderData.customer_name, orderData.wilaya_id || null, orderData.commune || '', orderData.address || '', existing.id]);
    return existing.id;
  }
  const info = run(
    `INSERT INTO customers (name, phone, phone2, email, wilaya_id, commune, address, notes, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, '', ?)`,
    [orderData.customer_name, phone, orderData.phone2 || '', orderData.wilaya_id || null,
      orderData.commune || '', orderData.address || '', now()],
  );
  return Number(info.lastInsertRowid);
}

router.post('/', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.customer_name || !b.phone) throw new HttpError(400, 'اسم الزبون ورقم الهاتف مطلوبان');
  if (!b.wilaya_id) throw new HttpError(400, 'الولاية مطلوبة');
  if (!Array.isArray(b.items) || !b.items.length) throw new HttpError(400, 'أضف منتجاً واحداً على الأقل');

  const customerId = createOrFindCustomer(b);
  const wilaya = get('SELECT * FROM wilayas WHERE wilaya_id = ?', [int(b.wilaya_id)]);
  const orderNum = b.order_number || orderNumber();
  const stamp = now();

  const info = run(
    `INSERT INTO orders (order_number, customer_id, customer_name, phone, phone2, wilaya_id, wilaya_name,
      commune, address, stop_desk, desk_code, desk_name, subtotal, shipping_fee, discount, total,
      status, payment_status, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unpaid', ?, ?, ?, ?)`,
    [
      orderNum, customerId, b.customer_name, String(b.phone), b.phone2 || '',
      int(b.wilaya_id), wilaya ? wilaya.name_fr : '', b.commune || '',
      b.address || '', bool01(b.stop_desk), b.desk_code || '', b.desk_name || '',
      0, num(b.shipping_fee), num(b.discount), 0, b.source || 'admin', b.notes || '', stamp, stamp,
    ],
  );
  const orderId = Number(info.lastInsertRowid);

  let subtotal = 0;
  for (const it of b.items) {
    const qty = Math.max(1, int(it.qty, 1));
    const price = num(it.unit_price);
    const product = it.product_id ? get('SELECT * FROM products WHERE id = ?', [int(it.product_id)]) : null;
    const name = it.name || (product ? product.name_ar : 'منتج');
    const line = price * qty;
    subtotal += line;
    run(
      `INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderId, product ? product.id : null, name, product ? product.sku : (it.sku || ''), qty, price, line],
    );
    if (product && bool01(b.decrement_stock)) {
      run('UPDATE products SET stock = MAX(0, stock - ?), updated_at = ? WHERE id = ?', [qty, stamp, product.id]);
    }
  }
  const total = Math.max(0, subtotal + num(b.shipping_fee) - num(b.discount));
  run('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?', [subtotal, total, orderId]);

  // بيانات الشحن
  run(
    `INSERT INTO shipments (order_id, reference, type, stop_desk, produit, quantite, stock, produit_a_recuperer,
      boutique, remarque, weight, fragile, gps_link, ask_collection)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      orderId, b.reference || orderNum, int(b.type ?? 1), bool01(b.stop_desk),
      b.produit || b.items.map((i) => `${i.name || ''} x${i.qty}`).join(' / '),
      b.quantite || b.items.map((i) => i.qty).join(','),
      bool01(b.stock), b.produit_a_recuperer || '', b.boutique || '', b.remarque || b.notes || '',
      num(b.weight), bool01(b.fragile), b.gps_link || '', bool01(b.ask_collection),
    ],
  );

  logActivity(req.user.id, req.user.username, 'order.create', 'order', orderId, orderNum, 1);

  const order = loadOrder(orderId);
  let pushResult = null;
  if (bool01(b.push_to_ecotrack)) {
    try {
      pushResult = await pushOrderToEcotrack(order, req.user, bool01(b.validate_after_push));
    } catch (err) {
      pushResult = { ok: false, error: err.message, code: err.code };
    }
  }
  res.json({ ok: true, id: orderId, order: loadOrder(orderId), push: pushResult });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const existing = get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!existing) throw new HttpError(404, 'الطلبية غير موجودة');

  run(
    `UPDATE orders SET customer_name = ?, phone = ?, phone2 = ?, wilaya_id = ?, wilaya_name = ?, commune = ?,
      address = ?, stop_desk = ?, desk_code = ?, desk_name = ?, shipping_fee = ?, discount = ?,
      notes = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ?`,
    [
      b.customer_name ?? existing.customer_name,
      b.phone ?? existing.phone,
      b.phone2 ?? existing.phone2,
      int(b.wilaya_id ?? existing.wilaya_id),
      b.wilaya_name ?? existing.wilaya_name,
      b.commune ?? existing.commune,
      b.address ?? existing.address,
      bool01(b.stop_desk ?? existing.stop_desk),
      b.desk_code ?? existing.desk_code,
      b.desk_name ?? existing.desk_name,
      num(b.shipping_fee ?? existing.shipping_fee),
      num(b.discount ?? existing.discount),
      b.notes ?? existing.notes,
      b.payment_status ?? existing.payment_status,
      b.status ?? existing.status,
      now(), id,
    ],
  );

  if (Array.isArray(b.items)) {
    run('DELETE FROM order_items WHERE order_id = ?', [id]);
    let subtotal = 0;
    for (const it of b.items) {
      const qty = Math.max(1, int(it.qty, 1));
      const price = num(it.unit_price);
      subtotal += price * qty;
      run('INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, it.product_id ? int(it.product_id) : null, it.name || 'منتج', it.sku || '', qty, price, price * qty]);
    }
    const cur = get('SELECT shipping_fee, discount FROM orders WHERE id = ?', [id]);
    run('UPDATE orders SET subtotal = ?, total = ? WHERE id = ?',
      [subtotal, Math.max(0, subtotal + num(cur.shipping_fee) - num(cur.discount)), id]);
  } else {
    const cur = get('SELECT subtotal, shipping_fee, discount FROM orders WHERE id = ?', [id]);
    run('UPDATE orders SET total = ? WHERE id = ?',
      [Math.max(0, num(cur.subtotal) + num(cur.shipping_fee) - num(cur.discount)), id]);
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
  if (Object.keys(shipPatch).length) saveShipment(id, shipPatch);

  logActivity(req.user.id, req.user.username, 'order.update', 'order', id, existing.order_number, 1);
  res.json({ ok: true, order: loadOrder(id) });
}));

router.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = get('SELECT * FROM orders WHERE id = ?', [id]);
  if (!order) throw new HttpError(404, 'الطلبية غير موجودة');
  run('DELETE FROM order_events WHERE order_id = ?', [id]);
  run('DELETE FROM shipments WHERE order_id = ?', [id]);
  run('DELETE FROM order_items WHERE order_id = ?', [id]);
  run('DELETE FROM orders WHERE id = ?', [id]);
  logActivity(req.user.id, req.user.username, 'order.delete', 'order', id, order.order_number, 1);
  res.json({ ok: true });
}));

// ══════════════════════ الربط مع Ecotrack ══════════════════════
async function pushOrderToEcotrack(order, user, validateAfter = false) {
  const params = buildCreateParams(order);
  const res = await ecotrack.createOrder(params);
  const tracking = res.data?.tracking;
  if (!tracking) throw new EcotrackPushError('لم يُرجع Ecotrack رقم تتبع', res.data);
  saveShipment(order.id, {
    tracking,
    ecotrack_status: 'prete_a_expedier',
    pushed_at: now(),
    raw: JSON.stringify(res.data),
    produit: params.produit || '',
    quantite: params.quantite || '',
  });
  run("UPDATE orders SET status = 'prete_a_expedier', updated_at = ? WHERE id = ?", [now(), order.id]);
  recordEvent(order.id, tracking, 'prete_a_expedier', 'order_information_received_by_carrier',
    { details: 'تم إرسال الطلبية إلى Ecotrack' });
  logActivity(user?.id, user?.username, 'ecotrack.create', 'order', order.id, tracking, 1);

  let validated = false;
  if (validateAfter) {
    const v = await ecotrack.validOrder({ tracking, ask_collection: getSetting('ecotrack', {}).ask_collection ? 1 : 0 });
    saveShipment(order.id, { validated_at: now(), ask_collection: getSetting('ecotrack', {}).ask_collection ? 1 : 0 });
    logActivity(user?.id, user?.username, 'ecotrack.valid', 'order', order.id, tracking, 1);
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
  const order = loadOrder(id);
  if (!order) throw new HttpError(404, 'الطلبية غير موجودة');
  if (order.shipment?.tracking) throw new HttpError(409, 'هذه الطلبية مُرسلة مسبقاً برقم: ' + order.shipment.tracking);
  try {
    const result = await pushOrderToEcotrack(order, req.user, bool01(req.body?.validate));
    res.json({ ok: true, ...result, order: loadOrder(id) });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[push]', err);
    logActivity(req.user.id, req.user.username, 'ecotrack.create', 'order', id, err.message, 0);
    res.status(422).json({ ok: false, error: err.message, code: err.code ?? null, errors: err.errors ?? null });
  }
}));

/** 4. إرسال مجموعة (حتى 100 لكل نداء) */
router.post('/bulk-push', requireAuth, asyncRoute(async (req, res) => {
  const { ids, validate } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'اختر طلبية واحدة على الأقل');
  const cfg = getSetting('ecotrack', {});
  const chunkSize = 100;
  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const orders = chunk.map((id) => loadOrder(Number(id))).filter((o) => o && !o.shipment?.tracking);
    if (!orders.length) continue;
    const payloads = orders.map((o) => buildCreateParams(o));
    try {
      const r = await ecotrack.createOrdersBulk(payloads);
      const resultsMap = r.data?.results || {};
      orders.forEach((o, idx) => {
        const key = payloads[idx].reference !== undefined ? payloads[idx].reference : String(idx);
        const entry = resultsMap[key] ?? resultsMap[String(idx)] ?? null;
        if (entry && entry.success && entry.tracking) {
          saveShipment(o.id, { tracking: entry.tracking, ecotrack_status: 'prete_a_expedier', pushed_at: now(), raw: JSON.stringify(entry) });
          run("UPDATE orders SET status = 'prete_a_expedier', updated_at = ? WHERE id = ?", [now(), o.id]);
          recordEvent(o.id, entry.tracking, 'prete_a_expedier', 'order_information_received_by_carrier');
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
      });
    } catch (err) {
      orders.forEach((o) => { results.push({ id: o.id, ok: false, error: err.message }); failed += 1; });
    }
  }
  logActivity(req.user.id, req.user.username, 'ecotrack.bulk-create', 'order', '', `${success} ناجح / ${failed} فاشل`, failed === 0);
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
  const order = loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack بعد');
  const ask = req.body?.ask_collection !== undefined
    ? bool01(req.body.ask_collection)
    : (getSetting('ecotrack', {}).ask_collection ? 1 : 0);
  const r = await ecotrack.validOrder({ tracking, ask_collection: ask });
  saveShipment(id, { validated_at: now(), ask_collection: ask });
  run("UPDATE orders SET status = 'en_ramassage', updated_at = ? WHERE id = ?", [now(), id]);
  recordEvent(id, tracking, 'en_ramassage', 'picked', { details: ask ? 'مع طلب الاستلام' : '' });
  logActivity(req.user.id, req.user.username, 'ecotrack.valid', 'order', id, tracking, 1);
  res.json({ ok: true, data: r.data, order: loadOrder(id) });
}));

/** 5. تعديل الطلبية عند Ecotrack */
router.post('/:id/update-ecotrack', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = loadOrder(id);
  if (!order?.shipment?.tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const params = req.body?.sync_from_local
    ? buildUpdateParams(order)
    : buildUpdateParams(order, req.body?.fields || {});
  const r = await ecotrack.updateOrder(params);
  logActivity(req.user.id, req.user.username, 'ecotrack.update', 'order', id, params.tracking, 1);
  res.json({ ok: true, data: r.data, params });
}));

/** 6. حذف الطلبية من Ecotrack */
router.delete('/:id/ecotrack', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = loadOrder(id);
  if (!order?.shipment?.tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const r = await ecotrack.deleteOrder(order.shipment.tracking);
  saveShipment(id, { tracking: '', ecotrack_status: '', pushed_at: null, validated_at: null, raw: null });
  run("UPDATE orders SET status = 'draft', updated_at = ? WHERE id = ?", [now(), id]);
  logActivity(req.user.id, req.user.username, 'ecotrack.delete', 'order', id, order.shipment.tracking, 1);
  res.json({ ok: true, data: r.data, order: loadOrder(id) });
}));

/** 9. ملصق الشحن PDF */
router.get('/:id/label', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = loadOrder(id);
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
  const order = loadOrder(id);
  const tracking = order?.shipment?.tracking || req.body?.tracking;
  const content = String(req.body?.content || '').trim();
  if (!tracking) throw new HttpError(400, 'لا يوجد رقم تتبع');
  if (!content) throw new HttpError(400, 'نص الملاحظة مطلوب');
  const r = await ecotrack.addMaj({ tracking, content });
  recordEvent(id, tracking, order?.shipment?.ecotrack_status || '', 'notification_on_order', { details: content });
  logActivity(req.user.id, req.user.username, 'ecotrack.addMaj', 'order', id, tracking, 1);
  res.json({ ok: true, data: r.data });
}));

/** 11. قراءة الملاحظات */
router.get('/:id/maj', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'لا يوجد رقم تتبع');
  const r = await ecotrack.getMaj(tracking);
  res.json({ ok: true, data: r.data });
}));

/** 12. طلب إرجاع */
router.post('/:id/ask-return', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = loadOrder(id);
  if (!order?.shipment?.tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const r = await ecotrack.askForOrderReturn(order.shipment.tracking);
  saveShipment(id, { return_asked_at: now() });
  recordEvent(id, order.shipment.tracking, 'retour_en_traitement', 'return_asked');
  logActivity(req.user.id, req.user.username, 'ecotrack.askReturn', 'order', id, order.shipment.tracking, 1);
  res.json({ ok: true, data: r.data, order: loadOrder(id) });
}));

/** 13. مزامنة حالة طلبية واحدة */
router.post('/:id/sync', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const order = loadOrder(id);
  const tracking = order?.shipment?.tracking;
  if (!tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
  const r = await ecotrack.getTrackingInfo(tracking);
  const info = r.data || {};
  const activity = Array.isArray(info.activity) ? info.activity : [];
  const last = activity[activity.length - 1];
  const status = info.status || last?.status || order.shipment.ecotrack_status || '';

  saveShipment(id, {
    ecotrack_status: typeof status === 'string' && isActivityKey(status) ? mapActivityToStatus(status) : (info.status || status),
    last_activity: last?.status || '',
    last_activity_at: last ? `${last.date || ''} ${last.time || ''}`.trim() : '',
    synced_at: now(),
    raw: JSON.stringify(info),
  });
  run('DELETE FROM order_events WHERE order_id = ? AND tracking = ?', [id, tracking]);
  for (const a of activity) {
    recordEvent(id, tracking, mapActivityToStatus(a.status), a.status,
      { station: a.station || a.scanLocation || '', date: a.date || '', time: a.time || '' });
  }
  const localStatus = statusToLocal(status);
  if (localStatus) run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [localStatus, now(), id]);
  res.json({ ok: true, data: info, order: loadOrder(id) });
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
    const placeholders = ids.map(() => '?').join(',');
    const rows = all(`SELECT order_id, tracking FROM shipments WHERE order_id IN (${placeholders}) AND tracking IS NOT NULL AND tracking != ''`, ids.map(Number));
    trackings = rows;
  } else {
    trackings = all("SELECT order_id, tracking FROM shipments WHERE tracking IS NOT NULL AND tracking != '' ORDER BY order_id DESC LIMIT 100");
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
        saveShipment(orderId, {
          ecotrack_status: ecotrack.ECOTRACK_STATUSES.includes(localStatus) ? localStatus : localStatus,
          last_activity: last?.status || '',
          last_activity_at: last ? `${last.date || ''} ${last.time || ''}`.trim() : '',
          synced_at: now(),
          raw: JSON.stringify(entry),
        });
        if (ecotrack.ECOTRACK_STATUSES.includes(localStatus)) {
          run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [localStatus, now(), orderId]);
        }
        if (activity.length) {
          run('DELETE FROM order_events WHERE order_id = ? AND tracking = ?', [orderId, tracking]);
          for (const a of activity) {
            recordEvent(orderId, tracking, mapActivityToStatus(a.status), a.status,
              { station: a.station || '', driver: a.driver || '', details: a.details || a.reason || '', date: a.date || '', time: a.time || '' });
          }
        }
        updated += 1;
      }
    } catch (err) {
      errors.push(err.message);
    }
  }
  logActivity(req.user.id, req.user.username, 'ecotrack.syncStatus', 'order', '', `${updated} طلبية`, errors.length === 0);
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
      const exists = get('SELECT order_id FROM shipments WHERE tracking = ?', [tracking]);
      if (exists) {
        saveShipment(exists.order_id, {
          ecotrack_status: row.status || '',
          last_activity: '',
          synced_at: now(),
          raw: JSON.stringify(row),
        });
        run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [row.status || 'prete_a_expedier', now(), exists.order_id]);
        updated += 1;
        continue;
      }
      const wilayaId = num(row.wilaya_id, 0) || null;
      const wilaya = wilayaId ? get('SELECT name_fr FROM wilayas WHERE wilaya_id = ?', [wilayaId]) : null;
      let orderNum = row.reference || `ECO-${tracking}`;
      if (get('SELECT id FROM orders WHERE order_number = ?', [orderNum])) {
        orderNum = `${orderNum}-${tracking}`;
      }
      const stamp = now();
      const info = run(
        `INSERT INTO orders (order_number, customer_id, customer_name, phone, phone2, wilaya_id, wilaya_name,
          commune, address, stop_desk, subtotal, shipping_fee, discount, total, status, payment_status,
          source, notes, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, 'ecotrack', ?, ?, ?)`,
        [orderNum, row.client || 'عميل Ecotrack', String(row.phone || ''), String(row.phone_2 || ''),
          wilayaId, wilaya ? wilaya.name_fr : '', row.commune || '', row.adresse || '',
          num(row.montant) - num(row.tarif_prestation), num(row.tarif_prestation), num(row.montant),
          row.status || 'prete_a_expedier',
          ['encaisse_non_paye', 'paiements_prets', 'paye_et_archive'].includes(row.status) ? 'collected' : 'unpaid',
          `مستوردة من Ecotrack (${tracking})`, stamp, stamp],
      );
      const orderId = Number(info.lastInsertRowid);
      run("INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, NULL, ?, '', 1, ?, ?)",
        [orderId, row.products || 'منتج', num(row.montant) - num(row.tarif_prestation), num(row.montant) - num(row.tarif_prestation)]);
      run(
        `INSERT INTO shipments (order_id, tracking, reference, type, stop_desk, produit, ecotrack_status,
          delivery_fee, pushed_at, synced_at, raw) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [orderId, tracking, orderNum, num(row.type_id, 1), row.products || '', row.status || '',
          num(row.tarif_prestation), now(), now(), JSON.stringify(row)],
      );
      imported += 1;
    }
  }
  logActivity(req.user.id, req.user.username, 'ecotrack.import', 'order', '', `${imported} جديدة / ${updated} محدّثة`, errors.length === 0);
  res.json({ ok: errors.length === 0, imported, updated, errors });
}));

/** حساب سعر التوصيل المحفوظ محلياً */
router.post('/quote', requireAuth, asyncRoute(async (req, res) => {
  const { wilaya_id, stop_desk = 0, type = 1 } = req.body || {};
  const fee = get('SELECT * FROM shipping_fees WHERE wilaya_id = ?', [int(wilaya_id)]);
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
