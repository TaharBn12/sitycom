import express from 'express';
import { get, all } from '../db.js';
import { asyncRoute, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();

/** الولايات المحفوظة محلياً (بعد المزامنة) */
router.get('/wilayas', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ ok: true, wilayas: all('SELECT * FROM wilayas WHERE active = 1 ORDER BY wilaya_id') });
}));

router.get('/communes', requireAuth, asyncRoute(async (req, res) => {
  const wid = int(req.query.wilaya_id, 0);
  if (!wid) {
    res.json({ ok: true, communes: all('SELECT * FROM communes ORDER BY wilaya_id, name LIMIT 3000') });
    return;
  }
  res.json({ ok: true, communes: all('SELECT * FROM communes WHERE wilaya_id = ? ORDER BY name', [wid]) });
}));

router.get('/desks', requireAuth, asyncRoute(async (req, res) => {
  const w = req.query.wilaya_id ? int(req.query.wilaya_id) : null;
  const rows = w
    ? all(`SELECT * FROM desks WHERE wilaya LIKE (SELECT name_fr FROM wilayas WHERE wilaya_id = ?) ORDER BY name`, [w])
    : all('SELECT * FROM desks ORDER BY is_my_desk DESC, name');
  res.json({ ok: true, desks: rows });
}));

router.get('/fees', requireAuth, asyncRoute(async (req, res) => {
  const w = req.query.wilaya_id ? int(req.query.wilaya_id) : null;
  const rows = w
    ? all('SELECT * FROM shipping_fees WHERE wilaya_id = ?', [w])
    : all('SELECT * FROM shipping_fees ORDER BY wilaya_id');
  res.json({ ok: true, fees: rows });
}));

router.get('/products', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ ok: true, products: all('SELECT * FROM ecotrack_products ORDER BY reference') });
}));

/** كل البيانات المطلوبة لشاشة «طلبية جديدة» في نداء واحد */
router.get('/bootstrap', requireAuth, asyncRoute(async (_req, res) => {
  res.json({
    ok: true,
    wilayas: all('SELECT * FROM wilayas WHERE active = 1 ORDER BY wilaya_id'),
    communes: all('SELECT wilaya_id, name, code_postal, has_stop_desk FROM communes ORDER BY wilaya_id, name'),
    desks: all('SELECT id, name, wilaya, commune, address, phone FROM desks ORDER BY name'),
    fees: all('SELECT * FROM shipping_fees ORDER BY wilaya_id'),
  });
}));

export default router;
