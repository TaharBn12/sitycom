import express from 'express';
import { get, all } from '../db.js';
import { asyncRoute, num, int } from '../lib/util.js';
import { requireAuth } from '../lib/auth.js';
import * as ecotrack from '../lib/ecotrack.js';

const router = express.Router();

const n = (v) => num(v, 0);

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const days = Math.min(365, Math.max(7, int(req.query.days, 30)));
  const since = `datetime('now', '-${days} days')`;

  const totals = get(`SELECT
      COUNT(*) AS orders_count,
      COALESCE(SUM(total), 0) AS revenue,
      COALESCE(SUM(shipping_fee), 0) AS shipping_total,
      COALESCE(SUM(discount), 0) AS discount_total
    FROM orders WHERE created_at >= ${since}`);

  const pending = get(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('draft','prete_a_expedier','en_preparation','en_preparation_stock')`);
  const inTransit = get(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('en_ramassage','vers_hub','en_hub','vers_wilaya','en_livraison')`);
  const delivered = get(`SELECT COUNT(*) AS c FROM orders WHERE status IN ('livre_non_encaisse','encaisse_non_paye','paiements_prets','paye_et_archive')`);
  const returns = get(`SELECT COUNT(*) AS c FROM orders WHERE status LIKE 'retour%'`);
  const suspended = get(`SELECT COUNT(*) AS c FROM orders WHERE status = 'suspendu'`);
  const notPushed = get(`SELECT COUNT(*) AS c FROM orders o LEFT JOIN shipments s ON s.order_id = o.id WHERE s.tracking IS NULL OR s.tracking = ''`);
  const collected = get(`SELECT COALESCE(SUM(total),0) AS c FROM orders WHERE status IN ('encaisse_non_paye','paiements_prets','paye_et_archive')`);

  const statusCounts = all(`SELECT COALESCE(s.ecotrack_status, o.status) AS status, COUNT(*) AS count
    FROM orders o LEFT JOIN shipments s ON s.order_id = o.id GROUP BY status ORDER BY count DESC`);

  const daily = all(`SELECT date(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
    FROM orders WHERE created_at >= ${since} GROUP BY day ORDER BY day`);

  const topWilayas = all(`SELECT o.wilaya_id, o.wilaya_name, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue
    FROM orders o WHERE o.created_at >= ${since} GROUP BY o.wilaya_id, o.wilaya_name
    ORDER BY orders DESC LIMIT 8`);

  const topProducts = all(`SELECT oi.name, SUM(oi.qty) AS qty, COALESCE(SUM(oi.line_total),0) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ${since} GROUP BY oi.name ORDER BY qty DESC LIMIT 8`);

  const recent = all(`SELECT o.id, o.order_number, o.customer_name, o.phone, o.wilaya_name, o.total, o.status,
      o.created_at, s.tracking, s.ecotrack_status
    FROM orders o LEFT JOIN shipments s ON s.order_id = o.id ORDER BY o.id DESC LIMIT 10`);

  const lowStock = all(`SELECT id, name_ar, sku, stock FROM products WHERE active = 1 AND stock <= 5 ORDER BY stock ASC LIMIT 8`);

  const customers = get(`SELECT COUNT(*) AS c FROM customers`);
  const newCustomers = get(`SELECT COUNT(*) AS c FROM customers WHERE created_at >= ${since}`);

  res.json({
    ok: true,
    days,
    mock: ecotrack.isMock(),
    cards: {
      orders: n(totals?.orders_count),
      revenue: n(totals?.revenue),
      shipping: n(totals?.shipping_total),
      discount: n(totals?.discount_total),
      pending: n(pending?.c),
      in_transit: n(inTransit?.c),
      delivered: n(delivered?.c),
      returns: n(returns?.c),
      suspended: n(suspended?.c),
      not_pushed: n(notPushed?.c),
      collected: n(collected?.c),
      customers: n(customers?.c),
      new_customers: n(newCustomers?.c),
    },
    statusCounts,
    daily,
    topWilayas,
    topProducts,
    recent,
    lowStock,
  });
}));

// ── التقارير المفصّلة ─────────────────────────────────────────
router.get('/reports', requireAuth, asyncRoute(async (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);

  const summary = get(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
      COALESCE(SUM(shipping_fee),0) AS shipping, COALESCE(SUM(discount),0) AS discount,
      COALESCE(AVG(total),0) AS avg_order
    FROM orders WHERE date(created_at) BETWEEN ? AND ?`, [from, to]);

  const byDay = all(`SELECT date(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
      COALESCE(SUM(shipping_fee),0) AS shipping
    FROM orders WHERE date(created_at) BETWEEN ? AND ? GROUP BY day ORDER BY day`, [from, to]);

  const byWilaya = all(`SELECT o.wilaya_id, o.wilaya_name, COUNT(*) AS orders,
      COALESCE(SUM(o.total),0) AS revenue, COALESCE(SUM(o.shipping_fee),0) AS shipping,
      SUM(CASE WHEN o.status LIKE 'retour%' THEN 1 ELSE 0 END) AS returns,
      SUM(CASE WHEN o.status IN ('livre_non_encaisse','encaisse_non_paye','paiements_prets','paye_et_archive') THEN 1 ELSE 0 END) AS delivered
    FROM orders o WHERE date(o.created_at) BETWEEN ? AND ?
    GROUP BY o.wilaya_id, o.wilaya_name ORDER BY orders DESC`, [from, to]);

  const byProduct = all(`SELECT oi.name, oi.sku, SUM(oi.qty) AS qty, COALESCE(SUM(oi.line_total),0) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE date(o.created_at) BETWEEN ? AND ? GROUP BY oi.name, oi.sku ORDER BY revenue DESC LIMIT 50`, [from, to]);

  const byStatus = all(`SELECT COALESCE(s.ecotrack_status, o.status) AS status, COUNT(*) AS count,
      COALESCE(SUM(o.total),0) AS revenue
    FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
    WHERE date(o.created_at) BETWEEN ? AND ? GROUP BY status ORDER BY count DESC`, [from, to]);

  const byDeliveryType = all(`SELECT CASE WHEN o.stop_desk = 1 THEN 'stopdesk' ELSE 'home' END AS kind,
      COUNT(*) AS count, COALESCE(SUM(o.shipping_fee),0) AS shipping
    FROM orders o WHERE date(o.created_at) BETWEEN ? AND ? GROUP BY kind`, [from, to]);

  const deliveryPerformance = all(`SELECT s.ecotrack_status AS status, COUNT(*) AS count,
      COALESCE(SUM(s.delivery_fee),0) AS delivery_fees
    FROM shipments s JOIN orders o ON o.id = s.order_id
    WHERE date(o.created_at) BETWEEN ? AND ? AND s.tracking IS NOT NULL AND s.tracking != ''
    GROUP BY s.ecotrack_status ORDER BY count DESC`, [from, to]);

  res.json({
    ok: true, from, to,
    summary: {
      orders: n(summary?.orders), revenue: n(summary?.revenue), shipping: n(summary?.shipping),
      discount: n(summary?.discount), avg_order: n(summary?.avg_order),
    },
    byDay, byWilaya, byProduct, byStatus, byDeliveryType, deliveryPerformance,
  });
}));

export default router;
