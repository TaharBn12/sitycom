import express from 'express';
import { supabase, must, countRows, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, pagination, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();

/** قيمة بحث داخل صيغة or() مع تهريب الأحرف الخاصة */
const likeVal = (s) => JSON.stringify(`%${s}%`);

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 50, 500);
  let query = supabase.from('customers').select('*', { count: 'exact' });
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    query = query.or(`name.ilike.${likeVal(q)},phone.ilike.${likeVal(q)},commune.ilike.${likeVal(q)}`);
  }
  if (req.query.wilaya_id) query = query.eq('wilaya_id', int(req.query.wilaya_id));
  const rows = must(await query.order('id', { ascending: false }).range(offset, offset + limit - 1), 'customers.list');

  const countQuery = (() => {
    let c = supabase.from('customers').select('id', { count: 'exact', head: true });
    if (req.query.q) {
      const q = String(req.query.q).toLowerCase();
      c = c.or(`name.ilike.${likeVal(q)},phone.ilike.${likeVal(q)},commune.ilike.${likeVal(q)}`);
    }
    if (req.query.wilaya_id) c = c.eq('wilaya_id', int(req.query.wilaya_id));
    return c;
  })();
  const total = await countRows(countQuery, 'customers.count');

  // عدد الطلبيات وإجمالي المشتريات لكل عميل في الصفحة
  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))];
  const stats = phones.length
    ? must(await supabase.rpc('customers_stats', { p_phones: phones }), 'customers.stats')
    : [];
  const statsByPhone = new Map(stats.map((s) => [s.phone, s]));
  for (const r of rows) {
    r.orders_count = Number(statsByPhone.get(r.phone)?.orders_count || 0);
    r.total_spent = Number(statsByPhone.get(r.phone)?.total_spent || 0);
  }

  res.json({ ok: true, customers: rows, total, page, limit, pages: Math.ceil(total / limit) });
}));

router.post('/', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.phone) throw new HttpError(400, 'الاسم ورقم الهاتف مطلوبان');
  const exists = must(
    await supabase.from('customers').select('id').eq('phone', String(b.phone)).maybeSingle(),
    'customers.exists',
  );
  if (exists) throw new HttpError(409, 'يوجد عميل بنفس رقم الهاتف');
  const row = must(
    await supabase.from('customers').insert({
      name: b.name,
      phone: String(b.phone),
      phone2: b.phone2 || '',
      email: b.email || '',
      wilaya_id: b.wilaya_id ? int(b.wilaya_id) : null,
      commune: b.commune || '',
      address: b.address || '',
      notes: b.notes || '',
      created_at: now(),
    }).select('id').single(),
    'customers.create',
  );
  await logActivity(req.user.id, req.user.username, 'customer.create', 'customer', row.id, b.name, 1);
  res.json({ ok: true, id: Number(row.id) });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  must(
    await supabase.from('customers').update({
      name: b.name ?? '',
      phone: b.phone ?? '',
      phone2: b.phone2 ?? '',
      email: b.email ?? '',
      wilaya_id: b.wilaya_id ? int(b.wilaya_id) : null,
      commune: b.commune ?? '',
      address: b.address ?? '',
      notes: b.notes ?? '',
    }).eq('id', id),
    'customers.update',
  );
  await logActivity(req.user.id, req.user.username, 'customer.update', 'customer', id, '', 1);
  res.json({ ok: true });
}));

router.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  must(await supabase.from('customers').delete().eq('id', id), 'customers.delete');
  await logActivity(req.user.id, req.user.username, 'customer.delete', 'customer', id, '', 1);
  res.json({ ok: true });
}));

/** بحث سريع بالاسم أو الهاتف (يُستخدم في شاشة الطلبية الجديدة) */
router.get('/search', requireAuth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, customers: [] });
  const rows = must(
    await supabase.from('customers').select('*')
      .or(`name.ilike.${likeVal(q.toLowerCase())},phone.ilike.${likeVal(q)}`)
      .order('id', { ascending: false })
      .limit(12),
    'customers.search',
  );
  res.json({ ok: true, customers: rows });
}));

export default router;
