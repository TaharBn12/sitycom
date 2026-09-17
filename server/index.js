import './lib/env.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { seedIfEmpty, getSetting, setSetting } from './db.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

// ── المسارات العامة (بدون تسجيل دخول) ─────────────────────────
app.get('/api/public/status', (_req, res) => {
  const cfg = ecotrack.getConfig();
  const store = getSetting('store', {}) || {};
  res.json({
    ok: true,
    store,
    ecotrack: { connected: cfg.configured && !cfg.mock, mock: cfg.mock },
    currencies: 'DZD',
  });
});

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

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString(), mock: ecotrack.isMock() }));

app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'المسار غير موجود' }));

// ── الملفات الثابتة ───────────────────────────────────────────
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ── معالج الأخطاء ─────────────────────────────────────────────
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

// ── الإقلاع ───────────────────────────────────────────────────
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

seedIfEmpty();
purgeSessions();

// أول تشغيل: نُثبّت توكن Ecotrack القادم من ملف .env داخل الإعدادات
{
  const eco = getSetting('ecotrack', {}) || {};
  if (!eco.api_token && process.env.ECOTRACK_API_TOKEN) {
    setSetting('ecotrack', { ...eco, api_token: process.env.ECOTRACK_API_TOKEN });
  }
}

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

app.listen(PORT, HOST, () => {
  const cfg = ecotrack.getConfig();
  console.log('─'.repeat(60));
  console.log('  Sitycom — منصة التجارة الإلكترونية + Ecotrack');
  console.log(`  الخادم:   http://localhost:${PORT}`);
  console.log(`  لوحة التحكم: http://localhost:${PORT}/admin.html`);
  if (process.env.ADMIN_USERNAME) {
    console.log(`  الدخول: ${process.env.ADMIN_USERNAME} / ${process.env.ADMIN_PASSWORD || 'admin123'}`);
  }
  console.log(`  Ecotrack: ${cfg.configured && !cfg.mock ? cfg.baseUrl : 'وضع تجريبي (Mock) — أدخل الرابط والتوكن من الإعدادات'}`);
  console.log('─'.repeat(60));
});
