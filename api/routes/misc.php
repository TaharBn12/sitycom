<?php
/**
 * لوحة المعلومات · التقارير · العملاء · الإعدادات · المسارات العمومية
 */

/* ══════════════════════ لوحة المعلومات ══════════════════════ */
function rt_dashboard($method, $seg, $body) {
    require_auth();
    $n1 = $seg[1] ?? '';
    if ($n1 === 'reports') return rt_reports();
    if ($n1 !== '') throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');

    $days = max(7, min(365, intval0(param('days', 30), 30)));
    $since = date_ago_days($days);

    $totals = q_one("SELECT COUNT(*) AS orders_count, COALESCE(SUM(total),0) AS revenue,
                            COALESCE(SUM(shipping_fee),0) AS shipping_total, COALESCE(SUM(discount),0) AS discount_total
                     FROM orders WHERE created_at >= ?", [$since]) ?: [];
    $cnt = function ($sql, $params = []) { return (int) q_val($sql, $params, 0); };

    $cards = [
        'orders' => (int) ($totals['orders_count'] ?? 0),
        'revenue' => (float) ($totals['revenue'] ?? 0),
        'shipping' => (float) ($totals['shipping_total'] ?? 0),
        'discount' => (float) ($totals['discount_total'] ?? 0),
        'pending' => $cnt("SELECT COUNT(*) AS c FROM orders WHERE status IN ('draft','prete_a_expedier','en_preparation','en_preparation_stock')"),
        'in_transit' => $cnt("SELECT COUNT(*) AS c FROM orders WHERE status IN ('en_ramassage','vers_hub','en_hub','vers_wilaya','en_livraison')"),
        'delivered' => $cnt("SELECT COUNT(*) AS c FROM orders WHERE status IN ('livre_non_encaisse','encaisse_non_paye','paiements_prets','paye_et_archive')"),
        'returns' => $cnt("SELECT COUNT(*) AS c FROM orders WHERE status LIKE 'retour%'"),
        'suspended' => $cnt("SELECT COUNT(*) AS c FROM orders WHERE status = 'suspendu'"),
        'not_pushed' => $cnt("SELECT COUNT(*) AS c FROM orders o LEFT JOIN shipments s ON s.order_id = o.id WHERE s.tracking IS NULL OR s.tracking = ''"),
        'collected' => (float) q_val("SELECT COALESCE(SUM(total),0) AS c FROM orders WHERE status IN ('encaisse_non_paye','paiements_prets','paye_et_archive')", [], 0),
        'customers' => $cnt("SELECT COUNT(*) AS c FROM customers"),
        'new_customers' => $cnt("SELECT COUNT(*) AS c FROM customers WHERE created_at >= ?", [$since]),
    ];

    json_ok([
        'days' => $days,
        'mock' => eco_is_mock(),
        'cards' => $cards,
        'statusCounts' => q_all("SELECT COALESCE(s.ecotrack_status, o.status) AS st, COUNT(*) AS c
                                 FROM orders o LEFT JOIN shipments s ON s.order_id = o.id GROUP BY st ORDER BY c DESC"),
        'daily' => q_all("SELECT DATE(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
                          FROM orders WHERE created_at >= ? GROUP BY day ORDER BY day", [$since]),
        'topWilayas' => q_all("SELECT o.wilaya_id, o.wilaya_name, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue
                               FROM orders o WHERE o.created_at >= ? GROUP BY o.wilaya_id, o.wilaya_name
                               ORDER BY orders DESC LIMIT 8", [$since]),
        'topProducts' => q_all("SELECT oi.name, SUM(oi.qty) AS qty, COALESCE(SUM(oi.line_total),0) AS revenue
                                FROM order_items oi JOIN orders o ON o.id = oi.order_id
                                WHERE o.created_at >= ? GROUP BY oi.name ORDER BY qty DESC LIMIT 8", [$since]),
        'recent' => q_all("SELECT o.id, o.order_number, o.customer_name, o.phone, o.wilaya_name, o.total, o.status,
                                  o.created_at, s.tracking, s.ecotrack_status
                           FROM orders o LEFT JOIN shipments s ON s.order_id = o.id ORDER BY o.id DESC LIMIT 10"),
        'lowStock' => q_all("SELECT id, name_ar, sku, stock FROM products WHERE active = 1 AND stock <= 5 ORDER BY stock ASC LIMIT 8"),
    ]);
}

/* ══════════════════════ التقارير ══════════════════════ */
function rt_reports() {
    require_auth();
    $from = param('from') ?: date('Y-m-d', time() - (30 * 86400));
    $to = param('to') ?: date('Y-m-d');

    $summary = q_one("SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
                             COALESCE(SUM(shipping_fee),0) AS shipping, COALESCE(SUM(discount),0) AS discount,
                             COALESCE(AVG(total),0) AS avg_order
                      FROM orders WHERE DATE(created_at) BETWEEN ? AND ?", [$from, $to]) ?: [];

    json_ok([
        'from' => $from, 'to' => $to,
        'summary' => [
            'orders' => (int) ($summary['orders'] ?? 0),
            'revenue' => (float) ($summary['revenue'] ?? 0),
            'shipping' => (float) ($summary['shipping'] ?? 0),
            'discount' => (float) ($summary['discount'] ?? 0),
            'avg_order' => (float) ($summary['avg_order'] ?? 0),
        ],
        'byDay' => q_all("SELECT DATE(created_at) AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
                                 COALESCE(SUM(shipping_fee),0) AS shipping
                          FROM orders WHERE DATE(created_at) BETWEEN ? AND ? GROUP BY day ORDER BY day", [$from, $to]),
        'byWilaya' => q_all("SELECT o.wilaya_id, o.wilaya_name, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue,
                                    COALESCE(SUM(o.shipping_fee),0) AS shipping,
                                    SUM(CASE WHEN o.status LIKE 'retour%' THEN 1 ELSE 0 END) AS returns,
                                    SUM(CASE WHEN o.status IN ('livre_non_encaisse','encaisse_non_paye','paiements_prets','paye_et_archive') THEN 1 ELSE 0 END) AS delivered
                             FROM orders o WHERE DATE(o.created_at) BETWEEN ? AND ?
                             GROUP BY o.wilaya_id, o.wilaya_name ORDER BY orders DESC", [$from, $to]),
        'byProduct' => q_all("SELECT oi.name, oi.sku, SUM(oi.qty) AS qty, COALESCE(SUM(oi.line_total),0) AS revenue
                              FROM order_items oi JOIN orders o ON o.id = oi.order_id
                              WHERE DATE(o.created_at) BETWEEN ? AND ?
                              GROUP BY oi.name, oi.sku ORDER BY revenue DESC LIMIT 50", [$from, $to]),
        'byStatus' => q_all("SELECT COALESCE(s.ecotrack_status, o.status) AS st, COUNT(*) AS c, COALESCE(SUM(o.total),0) AS revenue
                             FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
                             WHERE DATE(o.created_at) BETWEEN ? AND ? GROUP BY st ORDER BY c DESC", [$from, $to]),
        'byDeliveryType' => q_all("SELECT CASE WHEN o.stop_desk = 1 THEN 'stopdesk' ELSE 'home' END AS kind,
                                          COUNT(*) AS c, COALESCE(SUM(o.shipping_fee),0) AS shipping
                                   FROM orders o WHERE DATE(o.created_at) BETWEEN ? AND ? GROUP BY kind", [$from, $to]),
        'deliveryPerformance' => q_all("SELECT s.ecotrack_status AS st, COUNT(*) AS c, COALESCE(SUM(s.delivery_fee),0) AS delivery_fees
                                        FROM shipments s JOIN orders o ON o.id = s.order_id
                                        WHERE DATE(o.created_at) BETWEEN ? AND ? AND s.tracking IS NOT NULL AND s.tracking <> ''
                                        GROUP BY s.ecotrack_status ORDER BY c DESC", [$from, $to]),
    ]);
}

/* ══════════════════════ العملاء ══════════════════════ */
function rt_customers($method, $seg, $body) {
    $u = require_auth();
    $n1 = $seg[1] ?? '';

    if ($n1 === 'search') {
        $q = trim((string) param('q', ''));
        if ($q === '') json_ok(['customers' => []]);
        $like = '%' . $q . '%';
        json_ok(['customers' => q_all("SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 12", [$like, $like])]);
    }

    if ($n1 === '') {
        if ($method === 'GET') {
            list($page, $limit, $offset) = pagination(50, 500);
            $where = [];
            $params = [];
            if (param('q')) {
                $like = '%' . mb_strtolower((string) param('q')) . '%';
                $where[] = "(LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(commune) LIKE ?)";
                array_push($params, $like, $like, $like);
            }
            if (param('wilaya_id')) { $where[] = 'wilaya_id = ?'; $params[] = intval0($_GET['wilaya_id']); }
            $w = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
            $rows = q_all("SELECT c.*,
                    (SELECT COUNT(*) FROM orders o WHERE o.phone = c.phone) AS orders_count,
                    (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.phone = c.phone) AS total_spent
                   FROM customers c $w ORDER BY c.id DESC LIMIT $limit OFFSET $offset", $params);
            $total = (int) q_val("SELECT COUNT(*) AS c FROM customers c $w", $params, 0);
            json_ok(['customers' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit,
                     'pages' => max(1, (int) ceil($total / $limit))]);
        }
        if ($method === 'POST') {
            if (empty($body['name']) || empty($body['phone'])) throw new HttpError(400, 'الاسم ورقم الهاتف مطلوبان');
            if (q_one("SELECT id FROM customers WHERE phone = ?", [$body['phone']])) throw new HttpError(409, 'يوجد عميل بنفس رقم الهاتف');
            $r = q_exec("INSERT INTO customers (name, phone, phone2, email, wilaya_id, commune, address, notes, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [$body['name'], $body['phone'], $body['phone2'] ?? '', $body['email'] ?? '',
                 !empty($body['wilaya_id']) ? intval0($body['wilaya_id']) : null,
                 $body['commune'] ?? '', $body['address'] ?? '', $body['notes'] ?? '', now()]);
            log_activity($u['id'], $u['username'], 'customer.create', 'customer', $r['id'], $body['name'], 1);
            json_ok(['id' => $r['id']]);
        }
    }

    $id = (int) $n1;
    if ($id > 0 && $method === 'PUT') {
        q_exec("UPDATE customers SET name = ?, phone = ?, phone2 = ?, email = ?, wilaya_id = ?, commune = ?, address = ?, notes = ? WHERE id = ?",
            [$body['name'] ?? '', $body['phone'] ?? '', $body['phone2'] ?? '', $body['email'] ?? '',
             !empty($body['wilaya_id']) ? intval0($body['wilaya_id']) : null,
             $body['commune'] ?? '', $body['address'] ?? '', $body['notes'] ?? '', $id]);
        log_activity($u['id'], $u['username'], 'customer.update', 'customer', $id, '', 1);
        json_ok();
    }
    if ($id > 0 && $method === 'DELETE') {
        q_exec("DELETE FROM customers WHERE id = ?", [$id]);
        log_activity($u['id'], $u['username'], 'customer.delete', 'customer', $id, '', 1);
        json_ok();
    }

    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}

/* ══════════════════════ الإعدادات ══════════════════════ */
function rt_settings($method, $seg, $body) {
    $u = require_auth();
    $n1 = $seg[1] ?? '';

    if ($n1 === '') {
        if ($method !== 'GET') throw new HttpError(405, 'طريقة غير مدعومة');
        json_ok([
            'settings' => mask_settings_token(all_settings()),
            'meta' => [
                'statuses' => eco_statuses(),
                'activities' => eco_activities(),
                'order_types' => eco_order_types(),
                'error_codes' => eco_error_codes(),
            ],
        ]);
    }
    if ($n1 === 'logs') {
        list($page, $limit, $offset) = pagination(50, 500);
        $where = [];
        $params = [];
        if (param('q')) {
            $like = '%' . (string) param('q') . '%';
            $where[] = "(action LIKE ? OR username LIKE ? OR details LIKE ?)";
            array_push($params, $like, $like, $like);
        }
        if (param('ok') === '0' || param('ok') === '1') { $where[] = 'ok = ?'; $params[] = intval0($_GET['ok']); }
        $w = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
        $rows = q_all("SELECT * FROM activity_log $w ORDER BY id DESC LIMIT $limit OFFSET $offset", $params);
        $total = (int) q_val("SELECT COUNT(*) AS c FROM activity_log $w", $params, 0);
        json_ok(['logs' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit,
                 'pages' => max(1, (int) ceil($total / $limit))]);
    }
    if ($n1 === 'stats' && ($seg[2] ?? '') === 'db') {
        $counts = [];
        foreach (['orders','order_items','products','customers','categories','shipments','order_events',
                  'wilayas','communes','desks','shipping_fees','ecotrack_products','activity_log','users'] as $t) {
            $counts[$t] = (int) q_val("SELECT COUNT(*) AS c FROM `$t`", [], 0);
        }
        json_ok(['counts' => $counts]);
    }
    if (in_array($n1, ['store', 'ecotrack', 'orders'], true) && $method === 'PUT') {
        $current = setting($n1, []);
        if (!is_array($current)) $current = [];
        $incoming = is_array($body) ? $body : [];
        if ($n1 === 'ecotrack' && isset($incoming['api_token']) && strpos((string) $incoming['api_token'], '•') !== false) {
            unset($incoming['api_token']);
        }
        if ($n1 === 'ecotrack' && empty($incoming['api_token'])) {
            unset($incoming['api_token']);
        }
        $merged = array_merge($current, $incoming);
        set_setting($n1, $merged);
        log_activity($u['id'], $u['username'], 'settings.update', 'settings', $n1, '', 1);
        json_ok(['group' => $n1, 'settings' => $merged]);
    }

    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}

/* ══════════════════════ عمومي (بدون دخول) ══════════════════════ */
function rt_public($method, $seg, $body) {
    $n1 = $seg[1] ?? '';

    if ($n1 === 'status') {
        $c = eco_config();
        json_ok([
            'store' => setting('store', []),
            'ecotrack' => ['connected' => !empty($c['configured']) && empty($c['mock']), 'mock' => !empty($c['mock'])],
            'currency' => cfg('currency', 'DZD'),
        ]);
    }

    if ($n1 === 'track') {
        if ($method === 'GET') {
            $tracking = trim((string) param('tracking', ''));
            if ($tracking === '') json_out(['ok' => false, 'error' => 'أدخل رقم التتبع'], 400);
            try {
                $r = eco_tracking_info($tracking);
                json_ok(['data' => $r['data'] ?? null, 'mock' => !empty($r['mock'])]);
            } catch (Exception $e) {
                json_out(['ok' => false, 'error' => $e->getMessage(),
                          'code' => $e instanceof EcotrackError ? $e->ecode : null], 422);
            }
        }
        if ($method === 'POST') {
            $list = isset($body['trackings']) ? $body['trackings'] : [];
            if (!is_array($list)) $list = array_filter(array_map('trim', preg_split('/[\n,\s]+/', (string) $list)));
            if (!$list) json_out(['ok' => false, 'error' => 'أدخل رقم تتبع واحداً على الأقل'], 400);
            if (count($list) > 100) json_out(['ok' => false, 'error' => 'الحد الأقصى 100 رقم تتبع'], 400);
            try {
                $r = eco_trackings_info(array_slice(array_values($list), 0, 100));
                json_ok(['data' => $r['data'] ?? null, 'mock' => !empty($r['mock'])]);
            } catch (Exception $e) {
                json_out(['ok' => false, 'error' => $e->getMessage()], 422);
            }
        }
    }

    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}
