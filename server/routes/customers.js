import express from 'express';
import { get, run, all, logActivity } from '../db.js';
import { asyncRoute, HttpError, now, pagination, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';

const router = express.Router();

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 50, 500);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push('(LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(commune) LIKE ?)');
    const q = `%${String(req.query.q).toLowerCase()}%`;
    params.push(q, q, q);
  }
  if (req.query.wilaya_id) { where.push('wilaya_id = ?'); params.push(int(req.query.wilaya_id)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(`SELECT c.*,
      (SELECT COUNT(*) FROM orders o WHERE o.phone = c.phone) AS orders_count,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.phone = c.phone) AS total_spent
     FROM customers c ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = Number(get(`SELECT COUNT(*) AS c FROM customers c ${w}`, params)?.c || 0);
  res.json({ ok: true, customers: rows, total, page, limit, pages: Math.ceil(total / limit) });
}));

router.post('/', requireAuth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.phone) throw new HttpError(400, 'الاسم ورقم الهاتف مطلوبان');
  const exists = get('SELECT id FROM customers WHERE phone = ?', [String(b.phone)]);
  if (exists) throw new HttpError(409, 'يوجد عميل بنفس رقم الهاتف');
  const info = run(
    `INSERT INTO customers (name, phone, phone2, email, wilaya_id, commune, address, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.name, String(b.phone), b.phone2 || '', b.email || '', b.wilaya_id ? int(b.wilaya_id) : null,
      b.commune || '', b.address || '', b.notes || '', now()],
  );
  logActivity(req.user.id, req.user.username, 'customer.create', 'customer', info.lastInsertRowid, b.name, 1);
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
}));

router.put('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  run(
    `UPDATE customers SET name = ?, phone = ?, phone2 = ?, email = ?, wilaya_id = ?, commune = ?, address = ?, notes = ? WHERE id = ?`,
    [b.name ?? '', b.phone ?? '', b.phone2 ?? '', b.email ?? '', b.wilaya_id ? int(b.wilaya_id) : null,
      b.commune ?? '', b.address ?? '', b.notes ?? '', id],
  );
  logActivity(req.user.id, req.user.username, 'customer.update', 'customer', id, '', 1);
  res.json({ ok: true });
}));

router.delete('/:id', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  run('DELETE FROM customers WHERE id = ?', [id]);
  logActivity(req.user.id, req.user.username, 'customer.delete', 'customer', id, '', 1);
  res.json({ ok: true });
}));

/** بحث سريع بالاسم أو الهاتف (يُستخدم في شاشة الطلبية الجديدة) */
router.get('/search', requireAuth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ ok: true, customers: [] });
  const like = `%${q.toLowerCase()}%`;
  const rows = all(
    `SELECT * FROM customers WHERE LOWER(name) LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 12`,
    [like, `%${q}%`],
  );
  res.json({ ok: true, customers: rows });
}));

export default router;
