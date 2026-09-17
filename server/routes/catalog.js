import express from 'express';
import { supabase, must, countRows, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, pagination, num, int, bool01, norm } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();

/** قيمة بحث داخل صيغة or() مع تهريب الأحرف الخاصة */
const likeVal = (s) => JSON.stringify(`%${s}%`);
const eqVal = (s) => JSON.stringify(String(s));

/** يفك تضمين اسم التصنيف من شكل  {categories:{name_ar}}  إلى حقل مسطح */
function flatCategory(row) {
  if (!row) return row;
  row.category_name = row.categories?.name_ar ?? null;
  delete row.categories;
  return row;
}

// ══════════════════════ التصنيفات ══════════════════════
router.get('/categories', requireAuth, asyncRoute(async (_req, res) => {
  const categories = must(await supabase.from('categories').select('*').order('id'), 'categories.list');
  res.json({ ok: true, categories });
}));

router.post('/categories', requireAuth, asyncRoute(async (req, res) => {
  const { name_ar, name_fr, name_en } = req.body || {};
  if (!name_ar) throw new HttpError(400, 'اسم التصنيف بالعربية مطلوب');
  const row = must(
    await supabase.from('categories').insert({
      name_ar, name_fr: name_fr || '', name_en: name_en || '',
      slug: String(Date.now()).slice(-6), active: 1, created_at: now(),
    }).select('id').single(),
    'categories.create',
  );
  await logActivity(req.user.id, req.user.username, 'category.create', 'category', row.id, name_ar, 1);
  res.json({ ok: true, id: Number(row.id) });
}));

router.put('/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { name_ar, name_fr, name_en, active } = req.body || {};
  must(
    await supabase.from('categories').update({
      name_ar: name_ar ?? '', name_fr: name_fr ?? '', name_en: name_en ?? '', active: bool01(active),
    }).eq('id', id),
    'categories.update',
  );
  await logActivity(req.user.id, req.user.username, 'category.update', 'category', id, '', 1);
  res.json({ ok: true });
}));

router.delete('/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  must(await supabase.from('products').update({ category_id: null }).eq('category_id', id), 'categories.detach');
  must(await supabase.from('categories').delete().eq('id', id), 'categories.delete');
  await logActivity(req.user.id, req.user.username, 'category.delete', 'category', id, '', 1);
  res.json({ ok: true });
}));

// ══════════════════════ المنتجات ══════════════════════
function applyProductFilters(query, req) {
  if (req.query.q) {
    const q = norm(req.query.q);
    query = query.or(
      `name_ar.ilike.${likeVal(q)},name_fr.ilike.${likeVal(q)},name_en.ilike.${likeVal(q)},sku.ilike.${likeVal(String(req.query.q).toLowerCase())}`,
    );
  }
  if (req.query.category_id) query = query.eq('category_id', int(req.query.category_id));
  if (req.query.status === 'low') query = query.lte('stock', 5);
  if (req.query.status === 'out') query = query.lte('stock', 0);
  if (req.query.status === 'active') query = query.eq('active', 1);
  if (req.query.status === 'inactive') query = query.eq('active', 0);
  return query;
}

router.get('/products', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 24, 500);
  const rows = must(
    await applyProductFilters(supabase.from('products').select('*, categories(name_ar)'), req)
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1),
    'products.list',
  );
  const total = await countRows(
    applyProductFilters(supabase.from('products').select('id', { count: 'exact', head: true }), req),
    'products.count',
  );
  res.json({
    ok: true,
    products: rows.map(flatCategory),
    total, page, limit, pages: Math.ceil(total / limit),
  });
}));

router.get('/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const product = must(
    await supabase.from('products').select('*, categories(name_ar)').eq('id', id).maybeSingle(),
    'products.get',
  );
  if (!product) throw new HttpError(404, 'المنتج غير موجود');
  res.json({ ok: true, product: flatCategory(product) });
}));

router.post('/products', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.name_ar) throw new HttpError(400, 'اسم المنتج مطلوب');
  const row = must(
    await supabase.from('products').insert({
      sku: b.sku || `SKU-${Date.now().toString().slice(-6)}`,
      name_ar: b.name_ar,
      name_fr: b.name_fr || '',
      name_en: b.name_en || '',
      description: b.description || '',
      price: num(b.price),
      cost: num(b.cost),
      stock: int(b.stock),
      category_id: b.category_id ? int(b.category_id) : null,
      image_url: b.image_url || '',
      weight: num(b.weight),
      fragile: bool01(b.fragile),
      ecotrack_reference: b.ecotrack_reference || b.sku || '',
      active: bool01(b.active ?? 1),
      created_at: now(),
      updated_at: now(),
    }).select('id').single(),
    'products.create',
  );
  await logActivity(req.user.id, req.user.username, 'product.create', 'product', row.id, b.name_ar, 1);
  res.json({ ok: true, id: Number(row.id) });
}));

router.put('/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const exists = must(await supabase.from('products').select('id').eq('id', id).maybeSingle(), 'products.exists');
  if (!exists) throw new HttpError(404, 'المنتج غير موجود');
  must(
    await supabase.from('products').update({
      sku: b.sku || '',
      name_ar: b.name_ar || '',
      name_fr: b.name_fr || '',
      name_en: b.name_en || '',
      description: b.description || '',
      price: num(b.price),
      cost: num(b.cost),
      stock: int(b.stock),
      category_id: b.category_id ? int(b.category_id) : null,
      image_url: b.image_url || '',
      weight: num(b.weight),
      fragile: bool01(b.fragile),
      ecotrack_reference: b.ecotrack_reference || '',
      active: bool01(b.active ?? 1),
      updated_at: now(),
    }).eq('id', id),
    'products.update',
  );
  await logActivity(req.user.id, req.user.username, 'product.update', 'product', id, b.name_ar || '', 1);
  res.json({ ok: true });
}));

router.patch('/products/:id/stock', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { delta, stock } = req.body || {};
  if (stock !== undefined) {
    must(
      await supabase.from('products').update({ stock: int(stock), updated_at: now() }).eq('id', id),
      'products.stock.set',
    );
  } else if (delta !== undefined) {
    must(await supabase.rpc('product_adjust_stock', { p_id: id, p_delta: int(delta) }), 'products.stock.delta');
  } else {
    throw new HttpError(400, 'أرسل stock أو delta');
  }
  const p = must(
    await supabase.from('products').select('id, stock, name_ar').eq('id', id).maybeSingle(),
    'products.stock.get',
  );
  await logActivity(req.user.id, req.user.username, 'product.stock', 'product', id, String(p?.stock ?? ''), 1);
  res.json({ ok: true, product: p });
}));

router.delete('/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  must(await supabase.from('order_items').delete().eq('product_id', id), 'products.items');
  must(await supabase.from('products').delete().eq('id', id), 'products.delete');
  await logActivity(req.user.id, req.user.username, 'product.delete', 'product', id, '', 1);
  res.json({ ok: true });
}));

// استيراد منتجات Ecotrack إلى الكتالوج المحلي
router.post('/products/import-ecotrack', requireAuth, asyncRoute(async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'لا توجد منتجات للاستيراد');
  let created = 0;
  let updated = 0;
  for (const it of items) {
    const ref = String(it.reference || '').trim();
    if (!ref) continue;
    const exists = must(
      await supabase.from('products').select('id')
        .or(`ecotrack_reference.eq.${eqVal(ref)},sku.eq.${eqVal(ref)}`)
        .maybeSingle(),
      'products.import.find',
    );
    if (exists) {
      must(
        await supabase.from('products')
          .update({ stock: int(it.stock_disponible), updated_at: now() })
          .eq('id', exists.id),
        'products.import.update',
      );
      updated += 1;
    } else {
      must(
        await supabase.from('products').insert({
          sku: ref,
          name_ar: it.title || ref,
          name_fr: it.title || ref,
          name_en: it.title || ref,
          description: '',
          price: 0,
          cost: 0,
          stock: int(it.stock_disponible),
          category_id: null,
          image_url: it.image || '',
          weight: 0,
          fragile: 0,
          ecotrack_reference: ref,
          active: 1,
          created_at: now(),
          updated_at: now(),
        }),
        'products.import.insert',
      );
      created += 1;
    }
  }
  await logActivity(req.user.id, req.user.username, 'product.import', 'product', '', `${created} جديد / ${updated} محدّث`, 1);
  res.json({ ok: true, created, updated });
}));

export default router;
