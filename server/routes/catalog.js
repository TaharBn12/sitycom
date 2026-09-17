import express from 'express';
import { get, run, all, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, pagination, num, int, bool01, norm } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();

// ══════════════════════ التصنيفات ══════════════════════
router.get('/categories', requireAuth, asyncRoute(async (_req, res) => {
  res.json({ ok: true, categories: all('SELECT * FROM categories ORDER BY id') });
}));

router.post('/categories', requireAuth, asyncRoute(async (req, res) => {
  const { name_ar, name_fr, name_en } = req.body || {};
  if (!name_ar) throw new HttpError(400, 'اسم التصنيف بالعربية مطلوب');
  const info = run(
    `INSERT INTO categories (name_ar, name_fr, name_en, slug, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    [name_ar, name_fr || '', name_en || '', String(Date.now()).slice(-6), now()],
  );
  logActivity(req.user.id, req.user.username, 'category.create', 'category', info.lastInsertRowid, name_ar, 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));

router.put('/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { name_ar, name_fr, name_en, active } = req.body || {};
  run(
    `UPDATE categories SET name_ar = ?, name_fr = ?, name_en = ?, active = ? WHERE id = ?`,
    [name_ar ?? '', name_fr ?? '', name_en ?? '', bool01(active), id],
  );
  logActivity(req.user.id, req.user.username, 'category.update', 'category', id, '', 1);
  res.json({ ok: true });
}));

router.delete('/categories/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  run('UPDATE products SET category_id = NULL WHERE category_id = ?', [id]);
  run('DELETE FROM categories WHERE id = ?', [id]);
  logActivity(req.user.id, req.user.username, 'category.delete', 'category', id, '', 1);
  res.json({ ok: true });
}));

// ══════════════════════ المنتجات ══════════════════════
function productSql(where, params, { page, limit, offset }) {
  const rows = all(
    `SELECT p.*, c.name_ar AS category_name
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     ${where}
     ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const totalRow = get(
    `SELECT COUNT(*) AS c FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}`,
    params,
  );
  return { rows, total: Number(totalRow?.c || 0), page, limit };
}

router.get('/products', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 24, 500);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(LOWER(p.name_ar) LIKE ? OR LOWER(p.name_fr) LIKE ? OR LOWER(p.name_en) LIKE ? OR LOWER(p.sku) LIKE ?)');
    const q = `%${norm(req.query.q)}%`;
    params.push(q, q, q, `%${String(req.query.q).toLowerCase()}%`);
  }
  if (req.query.category_id) { where.push('p.category_id = ?'); params.push(int(req.query.category_id)); }
  if (req.query.status === 'low') where.push('p.stock <= 5');
  if (req.query.status === 'out') where.push('p.stock <= 0');
  if (req.query.status === 'active') where.push('p.active = 1');
  if (req.query.status === 'inactive') where.push('p.active = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows, total } = productSql(w, params, { page, limit, offset });
  res.json({ ok: true, products: rows, total, page, limit, pages: Math.ceil(total / limit) });
}));

router.get('/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const product = get(
    `SELECT p.*, c.name_ar AS category_name FROM products p
     LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, [id]);
  if (!product) throw new HttpError(404, 'المنتج غير موجود');
  res.json({ ok: true, product });
}));

router.post('/products', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.name_ar) throw new HttpError(400, 'اسم المنتج مطلوب');
  const info = run(
    `INSERT INTO products (sku, name_ar, name_fr, name_en, description, price, cost, stock, category_id,
      image_url, weight, fragile, ecotrack_reference, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.sku || `SKU-${Date.now().toString().slice(-6)}`,
      b.name_ar, b.name_fr || '', b.name_en || '', b.description || '',
      num(b.price), num(b.cost), int(b.stock),
      b.category_id ? int(b.category_id) : null,
      b.image_url || '', num(b.weight), bool01(b.fragile),
      b.ecotrack_reference || b.sku || '', bool01(b.active ?? 1), now(), now(),
    ],
  );
  logActivity(req.user.id, req.user.username, 'product.create', 'product', info.lastInsertRowid, b.name_ar, 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));

router.put('/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const exists = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!exists) throw new HttpError(404, 'المنتج غير موجود');
  run(
    `UPDATE products SET sku = ?, name_ar = ?, name_fr = ?, name_en = ?, description = ?, price = ?, cost = ?,
      stock = ?, category_id = ?, image_url = ?, weight = ?, fragile = ?, ecotrack_reference = ?, active = ?, updated_at = ?
     WHERE id = ?`,
    [
      b.sku || '', b.name_ar || '', b.name_fr || '', b.name_en || '', b.description || '',
      num(b.price), num(b.cost), int(b.stock),
      b.category_id ? int(b.category_id) : null,
      b.image_url || '', num(b.weight), bool01(b.fragile),
      b.ecotrack_reference || '', bool01(b.active ?? 1), now(), id,
    ],
  );
  logActivity(req.user.id, req.user.username, 'product.update', 'product', id, b.name_ar || '', 1);
  res.json({ ok: true });
}));

router.patch('/products/:id/stock', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const { delta, stock } = req.body || {};
  if (stock !== undefined) {
    run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', [int(stock), now(), id]);
  } else if (delta !== undefined) {
    run('UPDATE products SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ?', [int(delta), now(), id]);
  } else {
    throw new HttpError(400, 'أرسل stock أو delta');
  }
  const p = get('SELECT id, stock, name_ar FROM products WHERE id = ?', [id]);
  logActivity(req.user.id, req.user.username, 'product.stock', 'product', id, String(p?.stock ?? ''), 1);
  res.json({ ok: true, product: p });
}));

router.delete('/products/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  run('DELETE FROM order_items WHERE product_id = ?', [id]);
  run('DELETE FROM products WHERE id = ?', [id]);
  logActivity(req.user.id, req.user.username, 'product.delete', 'product', id, '', 1);
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
    const exists = get('SELECT id FROM products WHERE ecotrack_reference = ? OR sku = ?', [ref, ref]);
    if (exists) {
      run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', [int(it.stock_disponible), now(), exists.id]);
      updated += 1;
    } else {
      run(
        `INSERT INTO products (sku, name_ar, name_fr, name_en, description, price, cost, stock, category_id,
          image_url, weight, fragile, ecotrack_reference, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 0, 0, ?, NULL, ?, 0, 0, ?, 1, ?, ?)`,
        [ref, it.title || ref, it.title || ref, it.title || ref, int(it.stock_disponible), it.image || '', ref, now(), now()],
      );
      created += 1;
    }
  }
  logActivity(req.user.id, req.user.username, 'product.import', 'product', '', `${created} جديد / ${updated} محدّث`, 1);
  res.json({ ok: true, created, updated });
}));

export default router;
