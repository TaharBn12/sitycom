import express from 'express';
import { supabase, must, chunk, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, int, bool01 } from '../lib/util.js';
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
/** تشخيص الربط: يعرض الرد الخام من Ecotrack لتحديد سبب فشل الولايات */
router.get('/diagnose', requireAuth, asyncRoute(async (_req, res) => {
  const cfg = await ec.getConfig();
  const out = {
    config: {
      base_url: cfg.baseUrl || '(فارغ)',
      has_token: Boolean(cfg.token),
      token_length: cfg.token ? cfg.token.length : 0,
      auth_mode: cfg.authMode,
      mock: cfg.mock,
      configured: cfg.configured,
    },
    hint: cfg.mock
      ? 'الوضع تجريبي: أدخل الرابط الأساسي والتوكن من «الإعدادات ← التوصيل» لتفعيل البيانات الحقيقية.'
      : null,
    tests: {},
  };

  const probe = async (name, fn, normalize) => {
    try {
      const r = await fn();
      const raw = r.data;
      const entry = {
        ok: true,
        mock: Boolean(r.mock),
        raw_type: Array.isArray(raw) ? 'array' : typeof raw,
        raw_keys: (raw && typeof raw === 'object' && !Array.isArray(raw)) ? Object.keys(raw).slice(0, 12) : null,
        sample: JSON.stringify(raw).slice(0, 500),
      };
      if (normalize) {
        const list = normalize(raw);
        entry.normalized_count = list.length;
        entry.normalized_sample = list.slice(0, 3);
      }
      out.tests[name] = entry;
    } catch (err) {
      out.tests[name] = { ok: false, error: err.message, code: err.code ?? null, status: err.status ?? null };
    }
  };

  await probe('validate_token', () => ec.validateToken());
  await probe('wilayas', () => ec.getWilayas(), ec.normalizeWilayas);
  await probe('communes_w16', () => ec.getCommunes(16), (d) => ec.normalizeCommunes(d, 16));
  await probe('fees', () => ec.getFees(), ec.normalizeFees);
  await probe('desks', () => ec.getDesks());

  res.json({ ok: true, diagnose: out });
}));

router.get('/status', requireAuth, asyncRoute(async (_req, res) => {
  const cfg = await ec.getConfig();
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
  const counts = must(await supabase.rpc('sync_counts'), 'eco.counts');
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
    counts,
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
    await logActivity(req.user.id, req.user.username, 'ecotrack.test', 'settings', '', 'VALID_TOKEN', 1);
    res.json({ ok: true, data: r.data, rate: r.rate, mock: Boolean(r.mock) });
  } catch (err) {
    await logActivity(req.user.id, req.user.username, 'ecotrack.test', 'settings', '', err.message, 0);
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
  await logActivity(req.user.id, req.user.username, 'ecotrack.createOrder', 'ecotrack', r.data?.tracking || '', '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/create-orders', requireAuth, asyncRoute(async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!orders.length) throw new HttpError(400, 'لا توجد طلبيات');
  if (orders.length > 100) throw new HttpError(400, 'الحد الأقصى 100 طلبية لكل نداء');
  const r = await ec.createOrdersBulk(orders);
  await logActivity(req.user.id, req.user.username, 'ecotrack.createOrders', 'ecotrack', '', `${orders.length} طلبية`, 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/update-order', requireAuth, asyncRoute(async (req, res) => {
  const r = await ec.updateOrder(req.body || {});
  await logActivity(req.user.id, req.user.username, 'ecotrack.updateOrder', 'ecotrack', req.body?.tracking || '', '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.delete('/order', requireAuth, asyncRoute(async (req, res) => {
  if (!req.query.tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
  const r = await ec.deleteOrder(String(req.query.tracking));
  await logActivity(req.user.id, req.user.username, 'ecotrack.deleteOrder', 'ecotrack', String(req.query.tracking), '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

router.post('/valid-order', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body?.tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
  const r = await ec.validOrder({ tracking: req.body.tracking, ask_collection: bool01(req.body.ask_collection) });
  await logActivity(req.user.id, req.user.username, 'ecotrack.validOrder', 'ecotrack', req.body.tracking, '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

/** 8. تأكيد استلام المرتجعات */
router.post('/valid-returns', requireAuth, asyncRoute(async (req, res) => {
  const trackings = Array.isArray(req.body?.trackings) ? req.body.trackings : [];
  if (!trackings.length) throw new HttpError(400, 'أدخل رقم تتبع واحداً على الأقل');
  const r = await ec.validReturns(trackings);
  for (const t of trackings) {
    const sh = must(
      await supabase.from('shipments').select('order_id').eq('tracking', t).maybeSingle(),
      'returns.find',
    );
    if (sh) {
      must(
        await supabase.from('shipments')
          .update({ ecotrack_status: 'retour_recu', synced_at: now() })
          .eq('order_id', sh.order_id),
        'returns.shipment',
      );
      must(
        await supabase.from('orders')
          .update({ status: 'retour_recu', updated_at: now() })
          .eq('id', sh.order_id),
        'returns.order',
      );
      must(
        await supabase.from('order_events').insert({
          order_id: sh.order_id, tracking: t, status: 'retour_recu', activity: 'Return_received',
          station: '', driver: '', details: 'تأكيد استلام المرتجع',
          event_date: new Date().toISOString().slice(0, 10), event_time: '', created_at: now(),
        }),
        'returns.event',
      );
    }
  }
  await logActivity(req.user.id, req.user.username, 'ecotrack.validReturns', 'ecotrack', '', trackings.join(','), 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

/** 10 / 11 — الملاحظات */
router.post('/maj', requireAuth, asyncRoute(async (req, res) => {
  if (!req.body?.tracking || !req.body?.content) throw new HttpError(400, 'رقم التتبع والنص مطلوبان');
  const r = await ec.addMaj({ tracking: req.body.tracking, content: req.body.content });
  await logActivity(req.user.id, req.user.username, 'ecotrack.addMaj', 'ecotrack', req.body.tracking, '', 1);
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
  await logActivity(req.user.id, req.user.username, 'ecotrack.askReturn', 'ecotrack', req.body.tracking, '', 1);
  res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
}));

// ══════════════════════ المزامنة ══════════════════════
async function startJob(kind) {
  const row = must(
    await supabase.from('sync_jobs')
      .insert({ kind, status: 'running', message: '', count: 0, started_at: now() })
      .select('id').single(),
    'job.start',
  );
  return Number(row.id);
}
async function endJob(id, status, message = '', count = 0) {
  await supabase.from('sync_jobs')
    .update({ status, message, count, finished_at: now() })
    .eq('id', id);
}

/** 17. مزامنة الولايات */
const syncWilayasHandler = asyncRoute(async (req, res) => {
  const job = await startJob('wilayas');
  try {
    const r = await ec.getWilayas();
    const list = ec.normalizeWilayas(r.data);
    if (!list.length) throw new HttpError(422, 'استجابة فارغة من Ecotrack');
    must(await supabase.from('wilayas').update({ active: 0 }).gte('wilaya_id', 1), 'sync.wilayas.reset');
    for (const w of list) {
      const exists = must(
        await supabase.from('wilayas').select('wilaya_id').eq('wilaya_id', w.wilaya_id).maybeSingle(),
        'sync.wilayas.find',
      );
      if (exists) {
        must(
          await supabase.from('wilayas')
            .update({ name_fr: w.name, active: 1, synced_at: now() })
            .eq('wilaya_id', w.wilaya_id),
          'sync.wilayas.update',
        );
      } else {
        must(
          await supabase.from('wilayas')
            .insert({ wilaya_id: w.wilaya_id, name_fr: w.name, name_ar: '', active: 1, synced_at: now() }),
          'sync.wilayas.insert',
        );
      }
    }
    await endJob(job, 'success', `${list.length} ولاية`, list.length);
    await logActivity(req.user.id, req.user.username, 'sync.wilayas', 'ecotrack', '', `${list.length}`, 1);
    res.json({ ok: true, count: list.length, mock: Boolean(r.mock) });
  } catch (err) {
    await endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
});

/** 19. مزامنة البلديات */
const syncCommunesHandler = asyncRoute(async (req, res) => {
  const job = await startJob('communes');
  try {
    const wilayaId = req.body?.wilaya_id ? int(req.body.wilaya_id) : null;
    let targets = [];
    if (wilayaId) targets = [wilayaId];
    else {
      targets = must(
        await supabase.from('wilayas').select('wilaya_id').eq('active', 1).order('wilaya_id'),
        'sync.communes.targets',
      ).map((w) => w.wilaya_id);
    }
    if (!targets.length) targets = Array.from({ length: 58 }, (_, i) => i + 1);

    let count = 0;
    const errors = [];
    for (const wid of targets) {
      try {
        const r = await ec.getCommunes(wid);
        const list = ec.normalizeCommunes(r.data, wid);
        if (!list.length) continue;
        must(await supabase.from('communes').delete().eq('wilaya_id', wid), 'sync.communes.clear');
        for (const part of chunk(list.map((c) => ({
          wilaya_id: wid, name: c.name, code_postal: c.code_postal, has_stop_desk: bool01(c.has_stop_desk),
        })), 400)) {
          must(
            await supabase.from('communes').upsert(part, { onConflict: 'wilaya_id,name', ignoreDuplicates: true }),
            'sync.communes.insert',
          );
        }
        count += list.length;
        if (list.some((c) => c.has_stop_desk)) {
          must(
            await supabase.from('wilayas').update({ has_stop_desk: 1, synced_at: now() }).eq('wilaya_id', wid),
            'sync.communes.wilaya',
          );
        }
        await sleep(120); // احترام 50 طلب/دقيقة
      } catch (err) {
        errors.push(`ولاية ${wid}: ${err.message}`);
      }
    }
    await endJob(job, errors.length ? 'partial' : 'success', errors.join(' | '), count);
    await logActivity(req.user.id, req.user.username, 'sync.communes', 'ecotrack', '', `${count} بلدية`, errors.length === 0);
    res.json({ ok: errors.length === 0, count, errors });
  } catch (err) {
    await endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
});

/** 18. مزامنة المكاتب */
const syncDesksHandler = asyncRoute(async (req, res) => {
  const job = await startJob('desks');
  try {
    const r = await ec.getDesks();
    const payload = r.data || {};
    must(await supabase.from('desks').delete().gte('id', 0), 'sync.desks.clear');
    const rows = [];
    const my = payload.my_desk;
    if (my) {
      rows.push({
        hub_id: String(my.hub_id ?? ''),
        name: my.hub_name || '',
        wilaya: my.location?.wilaya || '',
        commune: my.location?.commune || '',
        address: my.location?.adresse || '',
        phone: my.location?.phone || '',
        phone2: my.location?.phone2 || '',
        email: my.location?.email || '',
        map: my.location?.map || '',
        hours: JSON.stringify(my.working_hours || []),
        is_my_desk: 1,
      });
    }
    for (const d of payload.other_desks || []) {
      rows.push({
        hub_id: '',
        name: d.name || '',
        wilaya: d.wilaya || '',
        commune: d.commune || '',
        address: d.adresse || '',
        phone: d.phone || '',
        phone2: d.phone2 || '',
        email: '',
        map: d.map || '',
        hours: '',
        is_my_desk: 0,
      });
    }
    for (const part of chunk(rows, 400)) {
      must(await supabase.from('desks').insert(part), 'sync.desks.insert');
    }
    await endJob(job, 'success', `${rows.length} مكتب`, rows.length);
    await logActivity(req.user.id, req.user.username, 'sync.desks', 'ecotrack', '', `${rows.length}`, 1);
    res.json({ ok: true, count: rows.length, mock: Boolean(r.mock) });
  } catch (err) {
    await endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
});

/** 20. مزامنة الأسعار */
const syncFeesHandler = asyncRoute(async (req, res) => {
  const job = await startJob('fees');
  try {
    const r = await ec.getFees();
    const list = ec.normalizeFees(r.data);
    if (!list.length) throw new HttpError(422, 'استجابة فارغة من Ecotrack');
    const rows = list.map((f) => ({
      wilaya_id: f.wilaya_id,
      wilaya_name: f.wilaya_name,
      delivery_home: f.delivery_home,
      delivery_stopdesk: f.delivery_stopdesk,
      pickup_home: f.pickup_home,
      pickup_stopdesk: f.pickup_stopdesk,
      exchange_home: f.exchange_home,
      exchange_stopdesk: f.exchange_stopdesk,
      collection_home: f.collection_home,
      collection_stopdesk: f.collection_stopdesk,
      return_home: f.return_home,
      return_stopdesk: f.return_stopdesk,
      raw: JSON.stringify(f.raw),
      synced_at: now(),
    }));
    for (const part of chunk(rows, 400)) {
      must(await supabase.from('shipping_fees').upsert(part, { onConflict: 'wilaya_id' }), 'sync.fees.upsert');
    }
    await endJob(job, 'success', `${list.length} ولاية`, list.length);
    await logActivity(req.user.id, req.user.username, 'sync.fees', 'ecotrack', '', `${list.length}`, 1);
    res.json({ ok: true, count: list.length, mock: Boolean(r.mock) });
  } catch (err) {
    await endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
});

/** 21. مزامنة منتجات Ecotrack */
const syncProductsHandler = asyncRoute(async (req, res) => {
  const job = await startJob('products');
  try {
    const maxPages = Math.min(20, int(req.body?.pages, 3));
    let count = 0;
    for (let p = 1; p <= maxPages; p += 1) {
      const r = await ec.getProducts(p);
      const payload = r.data || {};
      const list = payload.products || (Array.isArray(payload) ? payload : []);
      if (!list.length) break;
      const rows = list.map((prod) => ({
        reference: String(prod.reference ?? ''),
        barcode: String(prod.barcode ?? ''),
        title: String(prod.title ?? ''),
        is_active: bool01(prod.is_active ?? 1),
        image: String(prod.image ?? ''),
        stock_disponible: int(prod.stock_disponible),
        stock_reserve: int(prod.stock_reserve),
        stock_phisique: int(prod.stock_phisique),
        synced_at: now(),
      }));
      for (const part of chunk(rows, 400)) {
        must(await supabase.from('ecotrack_products').upsert(part, { onConflict: 'reference' }), 'sync.products.upsert');
      }
      count += rows.length;
      if (payload.pagination && p >= int(payload.pagination.last_page, 1)) break;
      await sleep(120);
    }
    await endJob(job, 'success', `${count} منتج`, count);
    await logActivity(req.user.id, req.user.username, 'sync.products', 'ecotrack', '', `${count}`, 1);
    res.json({ ok: true, count });
  } catch (err) {
    await endJob(job, 'failed', err.message);
    res.status(422).json({ ok: false, error: err.message });
  }
});

/** مزامنة شاملة */
// تسجيل مسارات المزامنة
router.post('/sync/wilayas', requireAuth, syncWilayasHandler);
router.post('/sync/communes', requireAuth, syncCommunesHandler);
router.post('/sync/desks', requireAuth, syncDesksHandler);
router.post('/sync/fees', requireAuth, syncFeesHandler);
router.post('/sync/products', requireAuth, syncProductsHandler);

router.post('/sync/all', requireAuth, asyncRoute(async (req, res) => {
  const report = {};
  const results = {};
  // تنفيذ المزامنة داخليًا (بدون self-fetch — لا يعمل على Cloudflare Workers)
  const run = async (name, handler, body) => {
    let payload = null;
    const sub = Object.create(req);
    sub.body = body || {};
    sub.params = {};
    sub.query = {};
    const fakeRes = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(d) { payload = d; return this; },
    };
    try {
      await handler(sub, fakeRes, (e) => { if (e) throw e; });
    } catch (err) {
      payload = { ok: false, error: err.message };
    }
    results[name] = payload || { ok: false, error: 'لا استجابة' };
    await sleep(150);
  };

  await run('wilayas', syncWilayasHandler);
  await run('desks', syncDesksHandler);
  await run('fees', syncFeesHandler);
  if (req.body?.communes) await run('communes', syncCommunesHandler, { wilaya_id: req.body.wilaya_id });
  if (req.body?.products) await run('products', syncProductsHandler, { pages: req.body.pages });
  report.results = results;
  await logActivity(req.user.id, req.user.username, 'sync.all', 'ecotrack', '', '', 1);
  res.json({ ok: true, report });
}));

router.get('/sync-history', requireAuth, asyncRoute(async (_req, res) => {
  const jobs = must(
    await supabase.from('sync_jobs').select('*').order('id', { ascending: false }).limit(30),
    'sync.history',
  );
  res.json({ ok: true, jobs });
}));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default router;
