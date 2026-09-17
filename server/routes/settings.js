import express from 'express';
import { get, run, all, getSetting, setSetting, allSettings, logActivity } from '../db.js';
import { asyncRoute, HttpError, pagination, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';
import * as ecotrack from '../lib/ecotrack.js';

const router = express.Router();

function mask(token) {
  const t = String(token || '');
  if (!t) return '';
  if (t.length <= 12) return t.slice(0, 3) + '••••';
  return `${t.slice(0, 6)}••••••••${t.slice(-6)}`;
}

router.get('/', requireAuth, asyncRoute(async (_req, res) => {
  const settings = allSettings();
  if (settings.ecotrack) {
    settings.ecotrack = { ...settings.ecotrack, api_token: mask(settings.ecotrack.api_token) };
    settings.ecotrack._has_token = Boolean(ecotrack.getConfig().token);
  }
  res.json({
    ok: true,
    settings,
    meta: {
      statuses: ecotrack.ECOTRACK_STATUSES,
      activities: ecotrack.ACTIVITIES,
      order_types: ecotrack.ORDER_TYPES,
      error_codes: ecotrack.ERROR_CODES,
    },
  });
}));

router.put('/:group', requireAuth, asyncRoute(async (req, res) => {
  const group = String(req.params.group);
  if (!['store', 'ecotrack', 'orders'].includes(group)) throw new HttpError(400, 'مجموعة إعدادات غير معروفة');
  const current = getSetting(group, {}) || {};
  const incoming = req.body || {};
  // لا نسمح باستبدال التوكن بقناع
  if (group === 'ecotrack' && incoming.api_token && /•/.test(String(incoming.api_token))) {
    delete incoming.api_token;
  }
  const merged = { ...current, ...incoming };
  setSetting(group, merged);
  logActivity(req.user.id, req.user.username, 'settings.update', 'settings', group, '', 1);
  res.json({ ok: true, group, settings: merged });
}));

router.get('/logs', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 50, 500);
  const where = [];
  const params = [];
  if (req.query.q) { where.push('(action LIKE ? OR username LIKE ? OR details LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.ok === '0' || req.query.ok === '1') { where.push('ok = ?'); params.push(int(req.query.ok)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(`SELECT * FROM activity_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = Number(get(`SELECT COUNT(*) AS c FROM activity_log ${w}`, params)?.c || 0);
  res.json({ ok: true, logs: rows, total, page, limit, pages: Math.ceil(total / limit) });
}));

router.get('/stats/db', requireAuth, asyncRoute(async (_req, res) => {
  const counts = {};
  for (const t of ['orders', 'order_items', 'products', 'customers', 'categories', 'shipments',
    'order_events', 'wilayas', 'communes', 'desks', 'shipping_fees', 'ecotrack_products', 'activity_log', 'users']) {
    counts[t] = Number(get(`SELECT COUNT(*) AS c FROM ${t}`)?.c || 0);
  }
  res.json({ ok: true, counts });
}));

export default router;
