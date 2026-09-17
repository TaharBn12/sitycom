import express from 'express';
import { supabase, must, countRows, getSetting, setSetting, allSettings, logActivity } from '../db.js';
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

const likeVal = (s) => JSON.stringify(`%${s}%`);

router.get('/', requireAuth, asyncRoute(async (_req, res) => {
  const settings = await allSettings();
  if (settings.ecotrack) {
    settings.ecotrack = { ...settings.ecotrack, api_token: mask(settings.ecotrack.api_token) };
    settings.ecotrack._has_token = Boolean((await ecotrack.getConfig()).token);
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
  const current = (await getSetting(group, {})) || {};
  const incoming = req.body || {};
  // لا نسمح باستبدال التوكن بقناع
  if (group === 'ecotrack' && incoming.api_token && /•/.test(String(incoming.api_token))) {
    delete incoming.api_token;
  }
  const merged = { ...current, ...incoming };
  await setSetting(group, merged);
  await logActivity(req.user.id, req.user.username, 'settings.update', 'settings', group, '', 1);
  res.json({ ok: true, group, settings: merged });
}));

router.get('/logs', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 50, 500);
  const applyFilters = (q) => {
    if (req.query.q) {
      q = q.or(`action.ilike.${likeVal(req.query.q)},username.ilike.${likeVal(req.query.q)},details.ilike.${likeVal(req.query.q)}`);
    }
    if (req.query.ok === '0' || req.query.ok === '1') q = q.eq('ok', int(req.query.ok));
    return q;
  };
  const rows = must(
    await applyFilters(supabase.from('activity_log').select('*'))
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1),
    'logs.list',
  );
  const total = await countRows(
    applyFilters(supabase.from('activity_log').select('id', { count: 'exact', head: true })),
    'logs.count',
  );
  res.json({ ok: true, logs: rows, total, page, limit, pages: Math.ceil(total / limit) });
}));

router.get('/stats/db', requireAuth, asyncRoute(async (_req, res) => {
  const counts = must(await supabase.rpc('table_counts'), 'stats.counts');
  res.json({ ok: true, counts });
}));

export default router;
