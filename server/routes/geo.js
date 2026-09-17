import express from 'express';
import { supabase, must, fetchAllPages, REST_PAGE } from '../db.js';
import { asyncRoute, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();

/** الولايات المحفوظة محلياً (بعد المزامنة) */
router.get('/wilayas', requireAuth, asyncRoute(async (_req, res) => {
  const wilayas = must(
    await supabase.from('wilayas').select('*').eq('active', 1).order('wilaya_id'),
    'geo.wilayas',
  );
  res.json({ ok: true, wilayas });
}));

router.get('/communes', requireAuth, asyncRoute(async (req, res) => {
  const wid = int(req.query.wilaya_id, 0);
  if (!wid) {
    // كل البلديات (مع احترام حد 3000 كما في النسخة السابقة)
    const communes = (await fetchAllPages(
      (from, to) => supabase.from('communes')
        .select('wilaya_id, name, code_postal, has_stop_desk, id')
        .order('wilaya_id').order('name')
        .range(from, to),
      'geo.communes',
    )).slice(0, 3000);
    res.json({ ok: true, communes });
    return;
  }
  const communes = must(
    await supabase.from('communes').select('*').eq('wilaya_id', wid).order('name'),
    'geo.communes',
  );
  res.json({ ok: true, communes });
}));

router.get('/desks', requireAuth, asyncRoute(async (req, res) => {
  const w = req.query.wilaya_id ? int(req.query.wilaya_id) : null;
  let rows;
  if (w) {
    const wilaya = must(
      await supabase.from('wilayas').select('name_fr').eq('wilaya_id', w).maybeSingle(),
      'geo.desks.wilaya',
    );
    rows = must(
      await supabase.from('desks').select('*').ilike('wilaya', wilaya ? wilaya.name_fr : '').order('name'),
      'geo.desks',
    );
  } else {
    rows = must(
      await supabase.from('desks').select('*').order('is_my_desk', { ascending: false }).order('name'),
      'geo.desks',
    );
  }
  res.json({ ok: true, desks: rows });
}));

router.get('/fees', requireAuth, asyncRoute(async (req, res) => {
  const w = req.query.wilaya_id ? int(req.query.wilaya_id) : null;
  let query = supabase.from('shipping_fees').select('*');
  if (w) query = query.eq('wilaya_id', w);
  else query = query.order('wilaya_id');
  res.json({ ok: true, fees: must(await query, 'geo.fees') });
}));

router.get('/products', requireAuth, asyncRoute(async (_req, res) => {
  const products = must(await supabase.from('ecotrack_products').select('*').order('reference'), 'geo.products');
  res.json({ ok: true, products });
}));

/** كل البيانات المطلوبة لشاشة «طلبية جديدة» في نداء واحد */
router.get('/bootstrap', requireAuth, asyncRoute(async (_req, res) => {
  const [wilayas, communes, desks, fees] = await Promise.all([
    supabase.from('wilayas').select('*').eq('active', 1).order('wilaya_id'),
    fetchAllPages(
      (from, to) => supabase.from('communes')
        .select('wilaya_id, name, code_postal, has_stop_desk')
        .order('wilaya_id').order('name')
        .range(from, to),
      'geo.bootstrap.communes',
    ),
    supabase.from('desks').select('id, name, wilaya, commune, address, phone').order('name'),
    supabase.from('shipping_fees').select('*').order('wilaya_id'),
  ]);
  res.json({
    ok: true,
    wilayas: must(wilayas, 'geo.bootstrap.wilayas'),
    communes: communes.slice(0, 5 * REST_PAGE),
    desks: must(desks, 'geo.bootstrap.desks'),
    fees: must(fees, 'geo.bootstrap.fees'),
  });
}));

export default router;
