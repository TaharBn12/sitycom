import './lib/env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { supabase, seedIfEmpty, getSetting, setSetting } from './db.js';
import { attachUser, purgeSessions } from './lib/auth.js';
import { HttpError, asyncRoute } from './lib/util.js';
import * as ecotrack from './lib/ecotrack.js';

import authRouter from './routes/auth.js';
import catalogRouter from './routes/catalog.js';
import customersRouter from './routes/customers.js';
import ordersRouter from './routes/orders.js';
import ecotrackRouter from './routes/ecotrack.js';
import geoRouter from './routes/geo.js';
import dashboardRouter from './routes/dashboard.js';
import settingsRouter from './routes/settings.js';

// على Cloudflare Workers لا يوجد نظام ملفات ولا import.meta.url صالح
let PUBLIC_DIR = '';
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  PUBLIC_DIR = path.join(__dirname, '..', 'public');
} catch { /* بيئة Workers */ }

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// يسمح بالوصول من أي نطاق (مفيد عند فتح الواجهة عبر نطاق المعاينة)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(attachUser);

// سجل طلبات API — يكشف أي مشكلة في تمرير التوكن عبر الوكلاء
app.use('/api', (req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    const channel = req.headers.authorization ? 'authorization'
      : req.headers['x-session-token'] ? 'x-session-token'
      : req.query.token ? 'query'
      : 'none';
    console.log(`[api] ${req.method} ${req.originalUrl.replace(/token=[^&\s]+/g, 'token=***')} → ${res.statusCode} | token=${channel} user=${req.user ? req.user.id : '-'} | ${Date.now() - t0}ms`);
  });
  next();
});

// ── المسارات العامة (بدون تسجيل دخول) ─────────────────────────
app.get('/api/public/status', asyncRoute(async (_req, res) => {
  const cfg = await ecotrack.getConfig();
  const store = (await getSetting('store', {})) || {};
  res.json({
    ok: true,
    store,
    ecotrack: { connected: cfg.configured && !cfg.mock, mock: cfg.mock },
    currencies: 'DZD',
  });
}));

/** تتبّع عمومي للزبائن — GET /api/public/track?tracking=XXX */
app.get('/api/public/track', asyncRoute(async (req, res) => {
  const tracking = String(req.query.tracking || '').trim();
  if (!tracking) throw new HttpError(400, 'أدخل رقم التتبع');
  try {
    const r = await ecotrack.getTrackingInfo(tracking);
    res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message, code: err.code ?? null });
  }
}));

/** تتبّع عدة أرقام دفعة واحدة (للعموم) */
app.post('/api/public/track', asyncRoute(async (req, res) => {
  const list = Array.isArray(req.body?.trackings)
    ? req.body.trackings
    : String(req.body?.trackings || '').split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new HttpError(400, 'أدخل رقم تتبع واحداً على الأقل');
  if (list.length > 100) throw new HttpError(400, 'الحد الأقصى 100 رقم تتبع');
  try {
    const r = await ecotrack.getTrackingsInfo(list.slice(0, 100));
    res.json({ ok: true, data: r.data, mock: Boolean(r.mock) });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
}));

// ── مسارات التطبيق ────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/customers', customersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/ecotrack', ecotrackRouter);
app.use('/api/geo', geoRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/settings', settingsRouter);

app.get('/api/health', asyncRoute(async (_req, res) => {
  const probe = await supabase.from('settings').select('key').limit(1);
  const dbOk = !probe.error;
  res.json({
    ok: true,
    time: new Date().toISOString(),
    mock: await ecotrack.isMock(),
    db: dbOk ? 'supabase' : `خطأ: ${probe.error.message} — نفّذ database/supabase.sql في Supabase`,
  });
}));

app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'المسار غير موجود' }));

// ── الطبقة النهائية ───────────────────────────────────────────
// على Cloudflare Workers تُقدَّم الواجهة عبر Static Assets (لا نظام ملفات)،
// لذلك يُفعَّل express.static في بيئة Node فقط.
export function finalize({ static: withStatic = true } = {}) {
  if (withStatic) {
    app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
    app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  }
  // معالج الأخطاء — يجب أن يكون آخر طبقة
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[sitycom]', err);
    res.status(status).json({
      ok: false,
      error: err.message || 'خطأ في الخادم',
      code: err.code ?? null,
      details: err.details ?? null,
    });
  });
  return app;
}


// ── تهيئة أولى (تعمل مرة واحدة على Node ومرة لكل عزل على Cloudflare) ──
let bootPromise = null;

export async function bootstrap() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    try {
      const seeded = await seedIfEmpty();
      if (seeded) console.log('✔ تم إنشاء الجداول والبيانات التجريبية على Supabase');
    } catch (err) {
      console.error('⚠️  تعذّر الوصول إلى قاعدة بيانات Supabase:', err.message);
      console.error('   1) نفّذ database/supabase.sql في Supabase ← SQL Editor');
      console.error('   2) تحقق من SUPABASE_URL و SUPABASE_ANON_KEY');
    }
    await purgeSessions().catch(() => {});
    try {
      const eco = (await getSetting('ecotrack', {})) || {};
      if (!eco.api_token && process.env.ECOTRACK_API_TOKEN) {
        await setSetting('ecotrack', { ...eco, api_token: process.env.ECOTRACK_API_TOKEN });
      }
    } catch { /* القاعدة غير جاهزة بعد */ }
  })();
  return bootPromise;
}

export { PUBLIC_DIR };
export default app;
