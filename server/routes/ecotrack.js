import express from 'express';
import { get, run, all, getSetting, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, num, int, bool01 } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';
import * as ec from '../lib/ecotrack.js';

const router = express.Router();

/** يخفي التوكن في الواجهة */
function mask(token) {
  const t = String(token || '');
  if (!t) return '';
  if (t.length <= 12) return t.slice(0, 3) + '••••';
  return `${t.slice(0, 6)}••••••••${t.slice(-6)}`;
}

// ══════════════════════ حالة الربط ══════════════════════
router.get('/status', requireAuth, asyncRoute(async (_req, res) => {
  const cfg = ec.getConfig();
  let validation = null;
  if (cfg.configured && !cfg.mock) {
    try {
      const r = await ec.validateToken();
      validation = { ok: true, data: r.data, rate: r.rate };
    } catch (err) {
      validation = { ok: false, error: err.message };
    }
  } else if (cfg.mock && cfg.token) {
    const r = await ec.validateToken();
    validation = { ok: true, data: r.data, mock: true };
  }
  res.json({
    ok: true,
    config: {
      base_url: cfg.baseUrl,
      api_token: mask(cfg.token),
      has_token: Boolean(cfg.token),
      auth_mode: cfg.authMode,
      timeout: cfg.timeout,
      mock: cfg.mock,
      configured: cfg.configured,
    },
    validation,
    counts: {
      wilayas: Number(get('SELECT COUNT(*) AS c FROM wilayas')?.c || 0),
      communes: Number(get('SELECT COUNT(*) AS c FROM communes')?.c || 0),
      desks: Number(get('SELECT COUNT(*) AS c FROM desks')?.c || 0),
      fees: Number(get('SELECT COUNT(*) AS c FROM shipping_fees')?.c || 0),
      products: Number(get('SELECT COUNT(*) AS c FROM ecotrack_products')?.c || 0),
    },
    endpoints: ec.ORDER_TYPES,
  });
}));

/** 1. التحقق من التوكن */
router.post('/test', requireAuth, asyncRoute(async (req, res) => {
  const override = req.body?.base_url || req.body?.api_token ? {
    baseUrl: String(req.body.base_url || '').replace(/\/+$/, ''),
    token: req.body.api_token || '',
    authMode: req.body.auth_mode || 'both',
    timeout: 20000,
    mock: false,
    configured: true,
  } : undefined;
  try {
    const r = await ec.validateToken(override);
    logActivity(req.user.id, req.user.username, 'ecotrack.test', 'settings', '', 'VALID_TOKEN', 1);
    res.json({ ok: true, data: r.data, rate: r.rate, mock: Boolean(r.mock) });
  } catch (err) {
    logActivity(req.user.id, req.user.username, 'ecotrack.test', 'settings', '', err.message, 0);
    res.status(422).json({ ok: false, error: err.message, code: err.code ?? null });
  }
}));

/** 2. حد الطلبات */
router.get('/rate-limit', requireAuth, asyncRoute(async (_req, res) => {
  const r = await ec.getRateLimit();
  res.json({ ok: true, data: r.data, rate: r.rate, mock: Boolean(r.mock) });
}));

// ══════════════════════ القراءة المباشرة ══════════════════════
router.get('/wilayas', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getWilayas();
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/communes', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getCommunes(req.query.wilaya_id);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/desks', requireAuth, asyncRoute(async (_req, res) => {
  const r = await ec.getDesks();
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/fees', requireAuth, asyncRoute(async (_req, res) => {
  const r = await ec.getFees();
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/products', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getProducts(int(req.query.page, 1));
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/orders', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getOrders({
    page: req.query.page, start_date: req.query.start_date,
    end_date: req.query.end_date, tracking: req.query.tracking,
  });
  res.json({ ok: true, data: r.data, rate: r.rate, mock: Boolean(r.mock) });
}));

router.get('/orders-status', requireAuth, asyncRoute(async (req, res) => {
  const trackings = String(req.query.trackings || '').split(',').map((s) => s.trim()).filter(Boolean);
  const r = await ec.getOrdersStatus({ trackings, status: req.query.status || 'all' });
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/tracking/:tracking', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getTrackingInfo(req.params.tracking);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/trackings', requireAuth, asyncRoute(async (req, res) => {
  const list = Array.isArray(req.body?.trackings) ? req.body.trackings
    : String(req.body?.trackings || '').split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new HttpError(400, 'أدخل رقم تتبع واحداً على الأقل');
  if (list.length > 100) throw new HttpError(400, 'الحد الأقصى 100 رقم تتبع لكل نداء');
  const r = await ec.getTrackingsInfo(list.slice(0, 100));
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/label/:tracking', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getOrderLabel(req.params.tracking);
  res.setHeader('Content-Type', r.contentType || 'application/pdf');
  res.setHeader('Content-Disposition',
    `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="label-${req.params.tracking}.pdf"`);
  res.send(r.buffer);
}));

// ══════════════════════ كتابة مباشرة (3..12) ══════════════════════
router.post('/create-order', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.createOrder(req.body || {});
  logActivity(req.user.id, req.user.username, 'ecotrack.createOrder', 'ecotrack', r.data?.tracking || '', '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/create-orders', requireAuth, asyncRoute(async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!orders.length) throw new HttpError(400, 'لا توجد طلبيات');
  if (orders.length > 100) throw new HttpError(400, 'الحد الأقصى 100 طلبية لكل نداء');
  const r = await ec.createOrdersBulk(orders);
  logActivity(req.user.id, req.user.username, 'ecotrack.createOrders', 'ecotrack', '', `${orders.length} طلبية`, 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/update-order', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.updateOrder(req.body || {});
  logActivity(req.user.id, req.user.username, 'ecotrack.updateOrder', 'ecotrack', req.body?.tracking || '', '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.delete('/order', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
  const r = await ec.deleteOrder(String(req.query.tracking));
  logActivity(req.user.id, req.user.username, 'ecotrack.deleteOrder', 'ecotrack', String(req.query.tracking), '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/valid-order', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body?.tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
  const r = await ec.validOrder({ tracking: req.body.tracking, ask_collection: bool01(req.body.ask_collection) });
  logActivity(req.user.id, req.user.username, 'ecotrack.validOrder', 'ecotrack', req.body.tracking, '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

/** 8. تأكيد استلام المرتجعات */
router.post('/valid-returns', requireAuth, asyncRoute(async (req, res) => {
  const trackings = Array.isArray(req.body?.trackings) ? req.body.trackings : [];
  if (!trackings.length) throw new HttpError(400, 'أدخل رقم تتبع واحداً على الأقل');
  const r = await ec.validReturns(trackings);
  for (const t of trackings) {
    const sh = get('SELECT order_id FROM shipments WHERE tracking = ?', [t]);
    if (sh) {
      run('UPDATE shipments SET ecotrack_status = ?, synced_at = ? WHERE order_id = ?', ['retour_recu', now(), sh.order_id]);
      run("UPDATE orders SET status = 'retour_recu', updated_at = ? WHERE id = ?", [now(), sh.order_id]);
      run(`INSERT INTO order_events (order_id, tracking, status, activity, station, driver, details, event_date, event_time, created_at)
           VALUES (?, ?, 'retour_recu', 'Return_received', '', '', 'تأكيد استلام المرتجع', ?, '', ?)`,
        [sh.order_id, t, new Date().toISOString().slice(0, 10), now()]);
    }
  }
  logActivity(req.user.id, req.user.username, 'ecotrack.validReturns', 'ecotrack', '', trackings.join(','), 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

/** 10 / 11 — الملاحظات */
router.post('/maj', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body?.tracking || !req.body?.content) throw new HttpError(400, 'رقم التتبع والنص مطلوبان');
  const r = await ec.addMaj({ tracking: req.body.tracking, content: req.body.content });
  logActivity(req.user.id, req.user.username, 'ecotrack.addMaj', 'ecotrack', req.body.tracking, '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.get('/maj/:tracking', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.getMaj(req.params.tracking);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

/** 12. طلب إرجاع */
router.post('/ask-return', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body?.tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
  const r = await ec.askForOrderReturn(req.body.tracking);
  logActivity(req.user.id, req.user.username, 'ecotrack.askReturn', 'ecotrack', req.body.tracking, '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

// ══════════════════════ المزامنة ══════════════════════
function startJob(kind) {
  const info = run(
    'INSERT INTO sync_jobs (kind, status, message, count, started_at) VALUES (?, ?, ?, 0, ?)',
    [kind, 'running', '', now()],
  );
  return Number(info.lastInsertRowid);
}
function endJob(id, status, message = '', count = 0) {
  run('UPDATE sync_jobs SET status = ?, message = ?, count = ?, finished_at = ? WHERE id = ?', [status, message, count, now(), id]);
}

/** 17. مزامنة الولايات */
router.post('/sync/wilayas', requireAuth, asyncRoute(async (req, res) => {
  const job = startJob('wilayas');
  try {
    const r = await ec.getWilayas();
    const list = ec.normalizeWilayas(r.data);
    if (!list.length) throw new HttpError(422, 'استجابة فارغة من Ecotrack');
    run('UPDATE wilayas SET active = 0');
    for (const w of list) {
      const exists = get('SELECT wilaya_id FROM wilayas WHERE wilaya_id = ?', [w.wilaya_id]);
      if (exists) {
        run('UPDATE wilayas SET name_fr = ?, active = 1, synced_at = ? WHERE wilaya_id = ?', [w.name, now(), w.wilaya_id]);
      } else {
        run("INSERT INTO wilayas (wilaya_id, name_fr, name_ar, active, synced_at) VALUES (?, ?, '', 1, ?)", [w.wilaya_id, w.name, now()]);
      }
    }
    endJob(job, 'success', `${list.length} ولاية`, list.length);
    logActivity(req.user.id, req.user.username, 'sync.wilayas', 'ecotrack', '', `${list.length}`, 1);
    res.json({ ok: true, count: list.length, mock: Boolean(r.mock) });
  } catch (err) {
    endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
}));

/** 19. مزامنة البلديات */
router.post('/sync/communes', requireAuth, asyncRoute(async (req, res) => {
  const job = startJob('communes');
  try {
    const wilayaId = req.body?.wilaya_id ? int(req.body.wilaya_id) : null;
    let targets = [];
    if (wilayaId) targets = [wilayaId];
    else targets = all('SELECT wilaya_id FROM wilayas WHERE active = 1 ORDER BY wilaya_id').map((w) => w.wilaya_id);
    if (!targets.length) targets = Array.from({ length: 58 }, (_, i) => i + 1);

    let count = 0;
    const errors = [];
    for (const wid of targets) {
      try {
        const r = await ec.getCommunes(wid);
        const list = ec.normalizeCommunes(r.data);
        if (!list.length) continue;
        run('DELETE FROM communes WHERE wilaya_id = ?', [wid]);
        for (const c of list) {
          run('INSERT OR IGNORE INTO communes (wilaya_id, name, code_postal, has_stop_desk) VALUES (?, ?, ?, ?)',
            [wid, c.name, c.code_postal, bool01(c.has_stop_desk)]);
          count += 1;
        }
        if (list.some((c) => c.has_stop_desk)) {
          run('UPDATE wilayas SET has_stop_desk = 1, synced_at = ? WHERE wilaya_id = ?', [now(), wid]);
        }
        await sleep(120); // احترام 50 طلب/دقيقة
      } catch (err) {
        errors.push(`ولاية ${wid}: ${err.message}`);
      }
    }
    endJob(job, errors.length ? 'partial' : 'success', errors.join(' | '), count);
    logActivity(req.user.id, req.user.username, 'sync.communes', 'ecotrack', '', `${count} بلدية`, errors.length === 0);
    res.json({ ok: errors.length === 0, count, errors });
  } catch (err) {
    endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
}));

/** 18. مزامنة المكاتب */
router.post('/sync/desks', requireAuth, asyncRoute(async (req, res) => {
  const job = startJob('desks');
  try {
    const r = await ec.getDesks();
    const payload = r.data || {};
    run('DELETE FROM desks');
    let count = 0;
    const my = payload.my_desk;
    if (my) {
      run(`INSERT INTO desks (hub_id, name, wilaya, commune, address, phone, phone2, email, map, hours, is_my_desk)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [String(my.hub_id ?? ''), my.hub_name || '', my.location?.wilaya || '', my.location?.commune || '',
          my.location?.adresse || '', my.location?.phone || '', my.location?.phone2 || '',
          my.location?.email || '', my.location?.map || '', JSON.stringify(my.working_hours || [])]);
      count += 1;
    }
    for (const d of payload.other_desks || []) {
      run(`INSERT INTO desks (hub_id, name, wilaya, commune, address, phone, phone2, email, map, hours, is_my_desk)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ['', d.name || '', d.wilaya || '', d.commune || '', d.adresse || '', d.phone || '',
          d.phone2 || '', '', d.map || '', '']);
      count += 1;
    }
    endJob(job, 'success', `${count} مكتب`, count);
    logActivity(req.user.id, req.user.username, 'sync.desks', 'ecotrack', '', `${count}`, 1);
    res.json({ ok: true, count, mock: Boolean(r.mock) });
  } catch (err) {
    endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
}));

/** 20. مزامنة الأسعار */
router.post('/sync/fees', requireAuth, asyncRoute(async (req, res) => {
  const job = startJob('fees');
  try {
    const r = await ec.getFees();
    const list = ec.normalizeFees(r.data);
    if (!list.length) throw new HttpError(422, 'استجابة فارغة من Ecotrack');
    for (const f of list) {
      run(`INSERT INTO shipping_fees (wilaya_id, wilaya_name, delivery_home, delivery_stopdesk,
            pickup_home, pickup_stopdesk, exchange_home, exchange_stopdesk,
            collection_home, collection_stopdesk, return_home, return_stopdesk, raw, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(wilaya_id) DO UPDATE SET
             wilaya_name = excluded.wilaya_name,
             delivery_home = excluded.delivery_home, delivery_stopdesk = excluded.delivery_stopdesk,
             pickup_home = excluded.pickup_home, pickup_stopdesk = excluded.pickup_stopdesk,
             exchange_home = excluded.exchange_home, exchange_stopdesk = excluded.exchange_stopdesk,
             collection_home = excluded.collection_home, collection_stopdesk = excluded.collection_stopdesk,
             return_home = excluded.return_home, return_stopdesk = excluded.return_stopdesk,
             raw = excluded.raw, synced_at = excluded.synced_at`,
        [f.wilaya_id, f.wilaya_name, f.delivery_home, f.delivery_stopdesk, f.pickup_home, f.pickup_stopdesk,
          f.exchange_home, f.exchange_stopdesk, f.collection_home, f.collection_stopdesk,
          f.return_home, f.return_stopdesk, JSON.stringify(f.raw), now()]);
    }
    endJob(job, 'success', `${list.length} ولاية`, list.length);
    logActivity(req.user.id, req.user.username, 'sync.fees', 'ecotrack', '', `${list.length}`, 1);
    res.json({ ok: true, count: list.length, mock: Boolean(r.mock) });
  } catch (err) {
    endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
}));

/** 21. مزامنة منتجات Ecotrack */
router.post('/sync/products', requireAuth, asyncRoute(async (req, res) => {
  const job = startJob('products');
  try {
    const maxPages = Math.min(20, int(req.body?.pages, 3));
    let count = 0;
    for (let p = 1; p <= maxPages; p += 1) {
      const r = await ec.getProducts(p);
      const payload = r.data || {};
      const list = payload.products || (Array.isArray(payload) ? payload : []);
      if (!list.length) break;
      for (const prod of list) {
        run(`INSERT INTO ecotrack_products (reference, barcode, title, is_active, image, stock_disponible, stock_reserve, stock_phisique, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(reference) DO UPDATE SET
               barcode = excluded.barcode, title = excluded.title, is_active = excluded.is_active,
               image = excluded.image, stock_disponible = excluded.stock_disponible,
               stock_reserve = excluded.stock_reserve, stock_phisique = excluded.stock_phisique,
               synced_at = excluded.synced_at`,
          [String(prod.reference ?? ''), String(prod.barcode ?? ''), String(prod.title ?? ''),
            bool01(prod.is_active ?? 1), String(prod.image ?? ''), int(prod.stock_disponible),
            int(prod.stock_reserve), int(prod.stock_phisique), now()]);
        count += 1;
      }
      if (payload.pagination && p >= int(payload.pagination.last_page, 1)) break;
      await sleep(120);
    }
    endJob(job, 'success', `${count} منتج`, count);
    logActivity(req.user.id, req.user.username, 'sync.products', 'ecotrack', '', `${count}`, 1);
    res.json({ ok: true, count });
  } catch (err) {
    endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
}));

/** مزامنة شاملة */
router.post('/sync/all', requireAuth, asyncRoute(async (req, res) => {
  const report = {};
  const call = async (path, body = {}) => {
    try {
      await fetch(`${req.protocol}://${req.get('host')}/api/ecotrack${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.token}` },
        body: JSON.stringify(body),
      }).then((r) => r.json()).then((j) => j);
      return true;
    } catch {
      return false;
    }
  };
  // استدعاء داخلي مباشر لتجنّب تعقيد الشبكة
  const results = {};
  for (const [key, fn] of Object.entries({
    wilayas: () => ec.getWilayas(),
    desks: () => ec.getDesks(),
    fees: () => ec.getFees(),
  })) {
    try {
      const r = await fn();
      results[key] = { ok: true, mock: Boolean(r.mock) };
    } catch (err) {
      results[key] = { ok: false, error: err.message };
    }
    await sleep(150);
  }
  // تنفيذ المزامنة الفعلية عبر نفس المنطق
  const sync = async (routePath, body) => {
    await fetch(`${req.protocol}://${req.get('host')}/api/ecotrack${routePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.token}` },
      body: JSON.stringify(body || {}),
    }).catch(() => null);
  };
  await sync('/sync/wilayas');
  await sync('/sync/desks');
  await sync('/sync/fees');
  if (req.body?.communes) await sync('/sync/communes');
  if (req.body?.products) await sync('/sync/products');
  report.results = results;
  logActivity(req.user.id, req.user.username, 'sync.all', 'ecotrack', '', '', 1);
  res.json({ ok: true, report });
}));

router.get('/sync-history', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ ok: true, jobs: all('SELECT * FROM sync_jobs ORDER BY id DESC LIMIT 30') });
}));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default router;
