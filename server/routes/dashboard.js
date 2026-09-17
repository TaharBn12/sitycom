import express from 'express';
import { supabase, must } from '../db.js';
import { asyncRoute, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';
import * as ecotrack from '../lib/ecotrack.js';

const router = express.Router();

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const days = Math.min(365, Math.max(7, int(req.query.days, 30)));
  const data = must(await supabase.rpc('dashboard_data', { p_days: days }), 'dashboard');

  res.json({
    ok: true,
    days,
    mock: await ecotrack.isMock(),
    cards: data.cards,
    statusCounts: data.statusCounts,
    daily: data.daily,
    topWilayas: data.topWilayas,
    topProducts: data.topProducts,
    recent: data.recent,
    lowStock: data.lowStock,
  });
}));

// ── التقارير المفصّلة ─────────────────────────────────────────
router.get('/reports', requireAuth, asyncRoute(async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);

  const data = must(await supabase.rpc('reports_data', { p_from: from, p_to: to }), 'reports');

  res.json({ ok: true, from, to, ...data });
}));

export default router;
