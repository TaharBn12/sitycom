<?php
/**
 * الطلبيات + كل عمليات Ecotrack المرتبطة بها
 */

function rt_orders($method, $seg, $body) {
    $u = require_auth();
    $n1 = $seg[1] ?? '';
    $n2 = $seg[2] ?? '';

    /* ── القائمة ───────────────────────────────────────── */
    if ($n1 === '' || $n1 === null) {
        if ($method !== 'GET' && $method !== 'POST') throw new HttpError(405, 'طريقة غير مدعومة');
        if ($method === 'POST') return create_order($u, $body);
        return list_orders();
    }

    if ($n1 === 'bulk-push' && $method === 'POST')  return bulk_push($u, $body);
    if ($n1 === 'sync-status' && $method === 'POST') return sync_status($u, $body);
    if ($n1 === 'import-ecotrack' && $method === 'POST') return import_ecotrack_orders($u, $body);
    if ($n1 === 'quote' && $method === 'POST') return quote_fee($body);

    $id = (int) $n1;
    if ($id <= 0) throw new HttpError(404, 'الطلبية غير موجودة', 'NOT_FOUND');

    $action = $n2;

    if ($action === '') {
        if ($method === 'GET') {
            $order = load_order($id);
            if (!$order) throw new HttpError(404, 'الطلبية غير موجودة');
            json_ok(['order' => $order, 'mock' => eco_is_mock(), 'order_types' => eco_order_types()]);
        }
        if ($method === 'PUT') return update_order($u, $id, $body);
        if ($method === 'DELETE') return delete_order($u, $id);
    }

    if ($action === 'push' && $method === 'POST') {
        $order = load_order($id);
        if (!$order) throw new HttpError(404, 'الطلبية غير موجودة');
        if (!empty($order['shipment']['tracking'])) throw new HttpError(409, 'هذه الطلبية مُرسلة مسبقاً برقم: ' . $order['shipment']['tracking']);
        try {
            $result = push_order_to_ecotrack($order, $u, bool01(bparam('validate', 0)));
            json_ok(array_merge($result, ['order' => load_order($id)]));
        } catch (Exception $e) {
            log_activity($u['id'], $u['username'], 'ecotrack.create', 'order', $id, $e->getMessage(), 0);
            $errCode = $e instanceof EcotrackError ? $e->ecode : null;
            json_out(['ok' => false, 'error' => $e->getMessage(), 'code' => $errCode], 422);
        }
    }

    if ($action === 'validate' && $method === 'POST') return validate_order($u, $id, $body);
    if ($action === 'update-ecotrack' && $method === 'POST') return update_at_ecotrack($u, $id, $body);
    if ($action === 'sync' && $method === 'POST') return sync_one($u, $id);
    if ($action === 'maj') {
        if ($method === 'POST') return add_maj($u, $id, $body);
        if ($method === 'GET') return get_maj_order($id);
    }
    if ($action === 'ask-return' && $method === 'POST') return ask_return($u, $id);
    if ($action === 'ecotrack' && $method === 'DELETE') return delete_at_ecotrack($u, $id);
    if ($action === 'label' && $method === 'GET') return order_label($id);

    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}

/* ══════════════════════ القائمة ══════════════════════ */
function list_orders() {
    list($page, $limit, $offset) = pagination(25, 500);
    $where = [];
    $params = [];

    $q = param('q');
    if ($q) {
        $like = '%' . mb_strtolower((string) $q) . '%';
        $where[] = "(LOWER(o.order_number) LIKE ? OR LOWER(o.customer_name) LIKE ? OR o.phone LIKE ? OR s.tracking LIKE ? OR s.reference LIKE ?)";
        array_push($params, $like, $like, $like, $like, $like);
    }
    $status = param('status');
    if ($status && $status !== 'all') {
        $st = array_values(array_filter(array_map('trim', explode(',', (string) $status))));
        $ph = implode(',', array_fill(0, count($st), '?'));
        $where[] = "(o.status IN ($ph) OR s.ecotrack_status IN ($ph))";
        $params = array_merge($params, $st, $st);
    }
    if (param('wilaya_id')) { $where[] = 'o.wilaya_id = ?'; $params[] = intval0($_GET['wilaya_id']); }
    if (param('pushed') === '1') $where[] = "s.tracking IS NOT NULL AND s.tracking <> ''";
    if (param('pushed') === '0') $where[] = "(s.tracking IS NULL OR s.tracking = '')";
    if (param('start_date')) { $where[] = 'DATE(o.created_at) >= ?'; $params[] = param('start_date'); }
    if (param('end_date'))   { $where[] = 'DATE(o.created_at) <= ?'; $params[] = param('end_date'); }
    if (param('payment_status') && param('payment_status') !== 'all') { $where[] = 'o.payment_status = ?'; $params[] = param('payment_status'); }
    if (param('delivery') === 'stopdesk') $where[] = 'o.stop_desk = 1';
    if (param('delivery') === 'home')     $where[] = 'o.stop_desk = 0';

    $w = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
    $rows = q_all(
        "SELECT o.*, s.tracking, s.ecotrack_status, s.type AS ship_type, s.pushed_at, s.validated_at,
                s.return_asked_at, s.last_activity, s.last_activity_at,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
         FROM orders o LEFT JOIN shipments s ON s.order_id = o.id
         $w ORDER BY o.id DESC LIMIT $limit OFFSET $offset",
        $params
    );
    $total = (int) q_val("SELECT COUNT(*) AS c FROM orders o LEFT JOIN shipments s ON s.order_id = o.id $w", $params, 0);
    $stats = q_all("SELECT COALESCE(s.ecotrack_status, o.status) AS st, COUNT(*) AS c
                    FROM orders o LEFT JOIN shipments s ON s.order_id = o.id GROUP BY st ORDER BY c DESC");
    json_ok(['orders' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit,
             'pages' => max(1, (int) ceil($total / $limit)), 'stats' => $stats]);
}

/* ══════════════════════ الإنشاء ══════════════════════ */
function create_order($u, $b) {
    if (empty($b['customer_name']) || empty($b['phone'])) throw new HttpError(400, 'اسم الزبون ورقم الهاتف مطلوبان');
    if (empty($b['wilaya_id'])) throw new HttpError(400, 'الولاية مطلوبة');
    if (empty($b['items']) || !is_array($b['items'])) throw new HttpError(400, 'أضف منتجاً واحداً على الأقل');

    $phone = trim((string) $b['phone']);
    $customerId = null;
    $existing = q_one("SELECT id FROM customers WHERE phone = ?", [$phone]);
    if ($existing) {
        q_exec("UPDATE customers SET name = ?, wilaya_id = ?, commune = ?, address = ? WHERE id = ?",
            [$b['customer_name'], intval0($b['wilaya_id']), $b['commune'] ?? '', $b['address'] ?? '', $existing['id']]);
        $customerId = (int) $existing['id'];
    } else {
        $r = q_exec("INSERT INTO customers (name, phone, phone2, email, wilaya_id, commune, address, notes, created_at)
                     VALUES (?, ?, ?, '', ?, ?, ?, '', ?)",
            [$b['customer_name'], $phone, $b['phone2'] ?? '', intval0($b['wilaya_id']), $b['commune'] ?? '', $b['address'] ?? '', now()]);
        $customerId = $r['id'];
    }

    $wilaya = q_one("SELECT * FROM wilayas WHERE wilaya_id = ?", [intval0($b['wilaya_id'])]);
    $orderNumber = $b['order_number'] ?? order_number();
    $stamp = now();

    $res = q_exec(
        "INSERT INTO orders (order_number, customer_id, customer_name, phone, phone2, wilaya_id, wilaya_name,
            commune, address, stop_desk, desk_code, desk_name, subtotal, shipping_fee, discount, total,
            status, payment_status, source, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'unpaid', ?, ?, ?, ?)",
        [$orderNumber, $customerId, $b['customer_name'], $phone, $b['phone2'] ?? '',
         intval0($b['wilaya_id']), $wilaya ? $wilaya['name_fr'] : '', $b['commune'] ?? '', $b['address'] ?? '',
         bool01($b['stop_desk'] ?? 0), $b['desk_code'] ?? '', $b['desk_name'] ?? '',
         0, num($b['shipping_fee'] ?? 0), num($b['discount'] ?? 0), 0,
         $b['source'] ?? 'admin', $b['notes'] ?? '', $stamp, $stamp]
    );
    $orderId = $res['id'];

    $subtotal = 0;
    foreach ($b['items'] as $it) {
        $qty = max(1, intval0($it['qty'] ?? 1, 1));
        $price = num($it['unit_price'] ?? 0);
        $product = !empty($it['product_id']) ? q_one("SELECT * FROM products WHERE id = ?", [intval0($it['product_id'])]) : null;
        $name = $it['name'] ?? ($product ? $product['name_ar'] : 'منتج');
        $line = $price * $qty;
        $subtotal += $line;
        q_exec("INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$orderId, $product ? $product['id'] : null, $name, $product ? $product['sku'] : ($it['sku'] ?? ''), $qty, $price, $line]);
        if ($product && bool01($b['decrement_stock'] ?? 0)) {
            q_exec("UPDATE products SET stock = MAX(0, stock - ?), updated_at = ? WHERE id = ?", [$qty, $stamp, $product['id']]);
        }
    }
    $total = max(0, $subtotal + num($b['shipping_fee'] ?? 0) - num($b['discount'] ?? 0));
    q_exec("UPDATE orders SET subtotal = ?, total = ? WHERE id = ?", [$subtotal, $total, $orderId]);

    $produit = $b['produit'] ?? implode(' / ', array_map(function ($i) { return ($i['name'] ?? '') . ' x' . ($i['qty'] ?? 1); }, $b['items']));
    $quantite = $b['quantite'] ?? implode(',', array_map(function ($i) { return $i['qty'] ?? 1; }, $b['items']));

    q_exec(
        "INSERT INTO shipments (order_id, reference, type, stop_desk, produit, quantite, stock, produit_a_recuperer,
            boutique, remarque, weight, fragile, gps_link, ask_collection)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [$orderId, $b['reference'] ?? $orderNumber, intval0($b['type'] ?? 1, 1), bool01($b['stop_desk'] ?? 0),
         $produit, $quantite, bool01($b['stock'] ?? 0), $b['produit_a_recuperer'] ?? '', $b['boutique'] ?? '',
         $b['remarque'] ?? ($b['notes'] ?? ''), num($b['weight'] ?? 0), bool01($b['fragile'] ?? 0),
         $b['gps_link'] ?? '', bool01($b['ask_collection'] ?? 0)]
    );

    log_activity($u['id'], $u['username'], 'order.create', 'order', $orderId, $orderNumber, 1);

    $push = null;
    if (bool01($b['push_to_ecotrack'] ?? 0)) {
        try {
            $push = push_order_to_ecotrack(load_order($orderId), $u, bool01($b['validate_after_push'] ?? 0));
        } catch (Exception $e) {
            $push = ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    json_ok(['id' => $orderId, 'order' => load_order($orderId), 'push' => $push]);
}

/* ══════════════════════ التعديل والحذف ══════════════════════ */
function update_order($u, $id, $b) {
    $existing = q_one("SELECT * FROM orders WHERE id = ?", [$id]);
    if (!$existing) throw new HttpError(404, 'الطلبية غير موجودة');

    q_exec(
        "UPDATE orders SET customer_name = ?, phone = ?, phone2 = ?, wilaya_id = ?, wilaya_name = ?, commune = ?,
            address = ?, stop_desk = ?, desk_code = ?, desk_name = ?, shipping_fee = ?, discount = ?,
            notes = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ?",
        [$b['customer_name'] ?? $existing['customer_name'], $b['phone'] ?? $existing['phone'],
         $b['phone2'] ?? $existing['phone2'], intval0($b['wilaya_id'] ?? $existing['wilaya_id']),
         $b['wilaya_name'] ?? $existing['wilaya_name'], $b['commune'] ?? $existing['commune'],
         $b['address'] ?? $existing['address'], bool01($b['stop_desk'] ?? $existing['stop_desk']),
         $b['desk_code'] ?? $existing['desk_code'], $b['desk_name'] ?? $existing['desk_name'],
         num($b['shipping_fee'] ?? $existing['shipping_fee']), num($b['discount'] ?? $existing['discount']),
         $b['notes'] ?? $existing['notes'], $b['payment_status'] ?? $existing['payment_status'],
         $b['status'] ?? $existing['status'], now(), $id]
    );

    if (isset($b['items']) && is_array($b['items'])) {
        q_exec("DELETE FROM order_items WHERE order_id = ?", [$id]);
        $subtotal = 0;
        foreach ($b['items'] as $it) {
            $qty = max(1, intval0($it['qty'] ?? 1, 1));
            $price = num($it['unit_price'] ?? 0);
            $subtotal += $price * $qty;
            q_exec("INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [$id, !empty($it['product_id']) ? intval0($it['product_id']) : null, $it['name'] ?? 'منتج', $it['sku'] ?? '', $qty, $price, $price * $qty]);
        }
        $cur = q_one("SELECT shipping_fee, discount FROM orders WHERE id = ?", [$id]);
        q_exec("UPDATE orders SET subtotal = ?, total = ? WHERE id = ?",
            [$subtotal, max(0, $subtotal + num($cur['shipping_fee']) - num($cur['discount'])), $id]);
    } else {
        $cur = q_one("SELECT subtotal, shipping_fee, discount FROM orders WHERE id = ?", [$id]);
        q_exec("UPDATE orders SET total = ? WHERE id = ?",
            [max(0, num($cur['subtotal']) + num($cur['shipping_fee']) - num($cur['discount'])), $id]);
    }

    $patch = [];
    foreach (['type' => 'int', 'boutique' => 'str', 'remarque' => 'str', 'weight' => 'num', 'fragile' => 'bool',
              'gps_link' => 'str', 'stock' => 'bool', 'quantite' => 'str', 'produit_a_recuperer' => 'str',
              'ask_collection' => 'bool', 'produit' => 'str'] as $k => $kind) {
        if (!array_key_exists($k, $b)) continue;
        $patch[$k] = $kind === 'int' ? intval0($b[$k]) : ($kind === 'num' ? num($b[$k]) : ($kind === 'bool' ? bool01($b[$k]) : $b[$k]));
    }
    save_shipment($id, $patch);

    log_activity($u['id'], $u['username'], 'order.update', 'order', $id, $existing['order_number'], 1);
    json_ok(['order' => load_order($id)]);
}

function delete_order($u, $id) {
    $order = q_one("SELECT * FROM orders WHERE id = ?", [$id]);
    if (!$order) throw new HttpError(404, 'الطلبية غير موجودة');
    q_exec("DELETE FROM order_events WHERE order_id = ?", [$id]);
    q_exec("DELETE FROM shipments WHERE order_id = ?", [$id]);
    q_exec("DELETE FROM order_items WHERE order_id = ?", [$id]);
    q_exec("DELETE FROM orders WHERE id = ?", [$id]);
    log_activity($u['id'], $u['username'], 'order.delete', 'order', $id, $order['order_number'], 1);
    json_ok();
}

/* ══════════════════════ عمليات Ecotrack ══════════════════════ */
function bulk_push($u, $b) {
    $ids = isset($b['ids']) && is_array($b['ids']) ? $b['ids'] : [];
    if (!$ids) throw new HttpError(400, 'اختر طلبية واحدة على الأقل');
    $validate = bool01($b['validate'] ?? 0);
    $eco = setting('ecotrack', []);
    $ask = !empty($eco['ask_collection']) ? 1 : 0;

    $results = [];
    $success = 0;
    $failed = 0;
    foreach (array_chunk($ids, 100) as $chunk) {
        $orders = [];
        foreach ($chunk as $id) {
            $o = load_order((int) $id);
            if ($o && empty($o['shipment']['tracking'])) $orders[] = $o;
        }
        if (!$orders) continue;
        $payloads = [];
        $indexed = [];
        foreach ($orders as $i => $o) {
            $p = build_create_params($o);
            $payloads[(string) $i] = $p;
            $indexed[(string) $i] = $o;
        }
        try {
            $r = eco_create_orders($payloads);
            $map = $r['data']['results'] ?? [];
            foreach ($indexed as $i => $o) {
                $key = $payloads[$i]['reference'] ?? $i;
                $entry = $map[$key] ?? ($map[$i] ?? null);
                if (is_array($entry) && !empty($entry['success']) && !empty($entry['tracking'])) {
                    save_shipment($o['id'], ['tracking' => $entry['tracking'], 'ecotrack_status' => 'prete_a_expedier',
                        'pushed_at' => now(), 'raw' => json_encode($entry, JSON_UNESCAPED_UNICODE)]);
                    q_exec("UPDATE orders SET status = 'prete_a_expedier', updated_at = ? WHERE id = ?", [now(), $o['id']]);
                    record_event($o['id'], $entry['tracking'], 'prete_a_expedier', 'order_information_received_by_carrier');
                    if ($validate) {
                        try { eco_valid_order($entry['tracking'], $ask); save_shipment($o['id'], ['validated_at' => now(), 'ask_collection' => $ask]); }
                        catch (Exception $e) { /* تجاهل */ }
                    }
                    $results[] = ['id' => (int) $o['id'], 'ok' => true, 'tracking' => $entry['tracking']];
                    $success++;
                } else {
                    $msg = is_array($entry) ? flatten_entry($entry) : 'لم تتم الاستجابة لهذه الطلبية';
                    $results[] = ['id' => (int) $o['id'], 'ok' => false, 'error' => $msg];
                    $failed++;
                }
            }
        } catch (Exception $e) {
            foreach ($indexed as $o) { $results[] = ['id' => (int) $o['id'], 'ok' => false, 'error' => $e->getMessage()]; $failed++; }
        }
    }
    log_activity($u['id'], $u['username'], 'ecotrack.bulk-create', 'order', '', "$success ناجح / $failed فاشل", $failed === 0 ? 1 : 0);
    json_ok(['success' => $success, 'failed' => $failed, 'results' => $results]);
}

function flatten_entry($entry) {
    $parts = [];
    foreach ($entry as $k => $v) {
        if (in_array($k, ['success', 'error'], true)) continue;
        $parts[] = $k . ': ' . (is_array($v) ? implode(', ', $v) : (string) $v);
    }
    return implode(' | ', $parts) ?: ($entry['message'] ?? 'خطأ غير معروف');
}

function validate_order($u, $id, $b) {
    $order = load_order($id);
    $tracking = $order['shipment']['tracking'] ?? '';
    if (!$tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack بعد');
    $eco = setting('ecotrack', []);
    $ask = array_key_exists('ask_collection', $b) ? bool01($b['ask_collection']) : (!empty($eco['ask_collection']) ? 1 : 0);
    $r = eco_valid_order($tracking, $ask);
    save_shipment($id, ['validated_at' => now(), 'ask_collection' => $ask]);
    q_exec("UPDATE orders SET status = 'en_ramassage', updated_at = ? WHERE id = ?", [now(), $id]);
    record_event($id, $tracking, 'en_ramassage', 'picked', ['details' => $ask ? 'مع طلب الاستلام' : '']);
    log_activity($u['id'], $u['username'], 'ecotrack.valid', 'order', $id, $tracking, 1);
    json_ok(['data' => $r['data'] ?? null, 'order' => load_order($id)]);
}

function update_at_ecotrack($u, $id, $b) {
    $order = load_order($id);
    if (empty($order['shipment']['tracking'])) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
    $params = !empty($b['sync_from_local']) ? build_update_params($order) : build_update_params($order, $b['fields'] ?? []);
    $r = eco_update_order($params);
    log_activity($u['id'], $u['username'], 'ecotrack.update', 'order', $id, $params['tracking'] ?? '', 1);
    json_ok(['data' => $r['data'] ?? null, 'params' => $params]);
}

function delete_at_ecotrack($u, $id) {
    $order = load_order($id);
    if (empty($order['shipment']['tracking'])) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
    $r = eco_delete_order($order['shipment']['tracking']);
    save_shipment($id, ['tracking' => null, 'ecotrack_status' => '', 'pushed_at' => null, 'validated_at' => null, 'raw' => null]);
    q_exec("UPDATE orders SET status = 'draft', updated_at = ? WHERE id = ?", [now(), $id]);
    log_activity($u['id'], $u['username'], 'ecotrack.delete', 'order', $id, $order['shipment']['tracking'], 1);
    json_ok(['data' => $r['data'] ?? null, 'order' => load_order($id)]);
}

function order_label($id) {
    $order = load_order($id);
    $tracking = $order['shipment']['tracking'] ?? '';
    if (!$tracking) throw new HttpError(400, 'لا يوجد رقم تتبع لهذه الطلبية');
    $r = eco_order_label($tracking);
    header('Content-Type: ' . ($r['content_type'] ?: 'application/pdf'));
    $dispo = param('download') === '1' ? 'attachment' : 'inline';
    header("Content-Disposition: $dispo; filename=\"label-$tracking.pdf\"");
    echo $r['buffer'];
    exit;
}

function add_maj($u, $id, $b) {
    $order = load_order($id);
    $tracking = ($order['shipment']['tracking'] ?? '') ?: ($b['tracking'] ?? '');
    $content = trim((string) ($b['content'] ?? ''));
    if (!$tracking) throw new HttpError(400, 'لا يوجد رقم تتبع');
    if ($content === '') throw new HttpError(400, 'نص الملاحظة مطلوب');
    $r = eco_add_maj($tracking, $content);
    record_event($id, $tracking, $order['shipment']['ecotrack_status'] ?? '', 'notification_on_order', ['details' => $content]);
    log_activity($u['id'], $u['username'], 'ecotrack.addMaj', 'order', $id, $tracking, 1);
    json_ok(['data' => $r['data'] ?? null]);
}

function get_maj_order($id) {
    $order = load_order($id);
    $tracking = $order['shipment']['tracking'] ?? '';
    if (!$tracking) throw new HttpError(400, 'لا يوجد رقم تتبع');
    $r = eco_get_maj($tracking);
    json_ok(['data' => $r['data'] ?? null]);
}

function ask_return($u, $id) {
    $order = load_order($id);
    if (empty($order['shipment']['tracking'])) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
    $r = eco_ask_return($order['shipment']['tracking']);
    save_shipment($id, ['return_asked_at' => now()]);
    record_event($id, $order['shipment']['tracking'], 'retour_en_traitement', 'return_asked');
    log_activity($u['id'], $u['username'], 'ecotrack.askReturn', 'order', $id, $order['shipment']['tracking'], 1);
    json_ok(['data' => $r['data'] ?? null, 'order' => load_order($id)]);
}

function sync_one($u, $id) {
    $order = load_order($id);
    $tracking = $order['shipment']['tracking'] ?? '';
    if (!$tracking) throw new HttpError(400, 'الطلبية غير مُرسلة إلى Ecotrack');
    $r = eco_tracking_info($tracking);
    $info = $r['data'] ?: [];
    $activity = isset($info['activity']) && is_array($info['activity']) ? $info['activity'] : [];
    $last = $activity ? $activity[count($activity) - 1] : null;
    $status = $info['status'] ?? ($last['status'] ?? ($order['shipment']['ecotrack_status'] ?? ''));
    $finalStatus = is_activity_key($status) ? map_activity_to_status($status) : $status;

    save_shipment($id, [
        'ecotrack_status' => $finalStatus,
        'last_activity' => $last['status'] ?? '',
        'last_activity_at' => $last ? trim(($last['date'] ?? '') . ' ' . ($last['time'] ?? '')) : '',
        'synced_at' => now(),
        'raw' => json_encode($info, JSON_UNESCAPED_UNICODE),
    ]);
    q_exec("DELETE FROM order_events WHERE order_id = ? AND tracking = ?", [$id, $tracking]);
    foreach ($activity as $a) {
        record_event($id, $tracking, map_activity_to_status($a['status'] ?? ''), $a['status'] ?? '',
            ['station' => $a['station'] ?? ($a['scanLocation'] ?? ''), 'date' => $a['date'] ?? '', 'time' => $a['time'] ?? '']);
    }
    if (in_array($finalStatus, eco_statuses(), true)) {
        q_exec("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", [$finalStatus, now(), $id]);
    }
    log_activity($u['id'], $u['username'], 'ecotrack.sync', 'order', $id, $tracking, 1);
    json_ok(['data' => $info, 'order' => load_order($id)]);
}

function sync_status($u, $b) {
    $ids = isset($b['ids']) && is_array($b['ids']) && $b['ids'] ? $b['ids'] : null;
    $mode = $b['mode'] ?? 'status';
    if ($ids) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $rows = q_all("SELECT order_id, tracking FROM shipments WHERE order_id IN ($ph) AND tracking IS NOT NULL AND tracking <> ''",
            array_map('intval', $ids));
    } else {
        $rows = q_all("SELECT order_id, tracking FROM shipments WHERE tracking IS NOT NULL AND tracking <> '' ORDER BY order_id DESC LIMIT 100");
    }
    if (!$rows) throw new HttpError(400, 'لا توجد طلبيات مُرسلة للمزامنة');

    $byTracking = [];
    foreach ($rows as $r) $byTracking[$r['tracking']] = (int) $r['order_id'];
    $list = array_keys($byTracking);
    $updated = 0;
    $errors = [];

    foreach (array_chunk($list, 100) as $chunk) {
        try {
            $r = $mode === 'tracking' ? eco_trackings_info($chunk) : eco_get_orders_status($chunk, 'all');
            $payload = $r['data'] ?: [];
            $entries = [];
            if ($mode === 'tracking') {
                $entries = isset($payload[0]) || !$payload ? (array) $payload : [$payload];
            } else {
                $entries = array_values((array) ($payload['data'] ?? []));
            }
            foreach ($entries as $entry) {
                if (!is_array($entry)) continue;
                $tracking = $entry['tracking'] ?? ($entry['Tracking'] ?? null);
                if (!$tracking || !isset($byTracking[$tracking])) continue;
                $orderId = $byTracking[$tracking];
                $activity = isset($entry['activity']) && is_array($entry['activity']) ? $entry['activity'] : [];
                $last = $activity ? $activity[count($activity) - 1] : null;
                $status = $entry['status'] ?? ($last['status'] ?? '');
                $finalStatus = is_activity_key($status) ? map_activity_to_status($status) : $status;
                save_shipment($orderId, [
                    'ecotrack_status' => $finalStatus,
                    'last_activity' => $last['status'] ?? '',
                    'last_activity_at' => $last ? trim(($last['date'] ?? '') . ' ' . ($last['time'] ?? '')) : '',
                    'synced_at' => now(),
                    'raw' => json_encode($entry, JSON_UNESCAPED_UNICODE),
                ]);
                if (in_array($finalStatus, eco_statuses(), true)) {
                    q_exec("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", [$finalStatus, now(), $orderId]);
                }
                if ($activity) {
                    q_exec("DELETE FROM order_events WHERE order_id = ? AND tracking = ?", [$orderId, $tracking]);
                    foreach ($activity as $a) {
                        record_event($orderId, $tracking, map_activity_to_status($a['status'] ?? ''), $a['status'] ?? '',
                            ['station' => $a['station'] ?? '', 'driver' => $a['driver'] ?? '',
                             'details' => $a['details'] ?? ($a['reason'] ?? ''), 'date' => $a['date'] ?? '', 'time' => $a['time'] ?? '']);
                    }
                }
                $updated++;
            }
        } catch (Exception $e) {
            $errors[] = $e->getMessage();
        }
    }
    log_activity($u['id'], $u['username'], 'ecotrack.syncStatus', 'order', '', "$updated طلبية", empty($errors) ? 1 : 0);
    json_ok(['updated' => $updated, 'errors' => $errors]);
}

function import_ecotrack_orders($u, $b) {
    $pages = max(1, min(20, intval0($b['pages'] ?? 1, 1)));
    $imported = 0;
    $updated = 0;
    $errors = [];
    for ($p = 1; $p <= $pages; $p++) {
        try {
            $r = eco_get_orders(['page' => $p, 'start_date' => $b['start_date'] ?? null, 'end_date' => $b['end_date'] ?? null]);
        } catch (Exception $e) { $errors[] = $e->getMessage(); break; }
        $payload = $r['data'] ?: [];
        $rows = isset($payload['data']) && is_array($payload['data']) ? $payload['data'] : (isset($payload[0]) ? $payload : []);
        foreach ($rows as $row) {
            if (empty($row['tracking'])) continue;
            $tracking = $row['tracking'];
            $exists = q_one("SELECT order_id FROM shipments WHERE tracking = ?", [$tracking]);
            if ($exists) {
                save_shipment((int) $exists['order_id'], ['ecotrack_status' => $row['status'] ?? '', 'synced_at' => now(),
                    'raw' => json_encode($row, JSON_UNESCAPED_UNICODE)]);
                q_exec("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", [$row['status'] ?: 'prete_a_expedier', now(), (int) $exists['order_id']]);
                $updated++;
                continue;
            }
            $wilayaId = (int) ($row['wilaya_id'] ?? 0);
            $wilaya = $wilayaId ? q_one("SELECT name_fr FROM wilayas WHERE wilaya_id = ?", [$wilayaId]) : null;
            $orderNumber = $row['reference'] ?? ('ECO-' . $tracking);
            if (q_one("SELECT id FROM orders WHERE order_number = ?", [$orderNumber])) $orderNumber .= '-' . $tracking;
            $stamp = now();
            $subtotal = max(0, num($row['montant'] ?? 0) - num($row['tarif_prestation'] ?? 0));
            $res = q_exec(
                "INSERT INTO orders (order_number, customer_id, customer_name, phone, phone2, wilaya_id, wilaya_name,
                    commune, address, stop_desk, subtotal, shipping_fee, discount, total, status, payment_status,
                    source, notes, created_at, updated_at)
                 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, 'ecotrack', ?, ?, ?)",
                [$orderNumber, $row['client'] ?? 'عميل Ecotrack', (string) ($row['phone'] ?? ''), (string) ($row['phone_2'] ?? ''),
                 $wilayaId, $wilaya ? $wilaya['name_fr'] : '', $row['commune'] ?? '', $row['adresse'] ?? '',
                 $subtotal, num($row['tarif_prestation'] ?? 0), num($row['montant'] ?? 0), $row['status'] ?: 'prete_a_expedier',
                 in_array($row['status'] ?? '', ['encaisse_non_paye', 'paiements_prets', 'paye_et_archive'], true) ? 'collected' : 'unpaid',
                 "مستوردة من Ecotrack ($tracking)", $stamp, $stamp]
            );
            $orderId = $res['id'];
            $productName = $row['products'] ?? 'منتج';
            q_exec("INSERT INTO order_items (order_id, product_id, name, sku, qty, unit_price, line_total) VALUES (?, NULL, ?, '', 1, ?, ?)",
                [$orderId, $productName, $subtotal, $subtotal]);
            q_exec(
                "INSERT INTO shipments (order_id, tracking, reference, type, stop_desk, produit, ecotrack_status,
                    delivery_fee, pushed_at, synced_at, raw) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
                [$orderId, $tracking, $orderNumber, (int) ($row['type_id'] ?? 1), $productName, $row['status'] ?? '',
                 num($row['tarif_prestation'] ?? 0), now(), now(), json_encode($row, JSON_UNESCAPED_UNICODE)]
            );
            $imported++;
        }
    }
    log_activity($u['id'], $u['username'], 'ecotrack.import', 'order', '', "$imported جديدة / $updated محدّثة", empty($errors) ? 1 : 0);
    json_ok(['imported' => $imported, 'updated' => $updated, 'errors' => $errors]);
}

function quote_fee($b) {
    $wid = intval0($b['wilaya_id'] ?? 0);
    $desk = bool01($b['stop_desk'] ?? 0);
    $type = intval0($b['type'] ?? 1, 1);
    $fee = q_one("SELECT * FROM shipping_fees WHERE wilaya_id = ?", [$wid]);
    if (!$fee) json_ok(['found' => false, 'fee' => 0]);
    if ($type === 1)      $value = $desk ? $fee['delivery_stopdesk'] : $fee['delivery_home'];
    elseif ($type === 2)  $value = $desk ? $fee['exchange_stopdesk'] : $fee['exchange_home'];
    elseif ($type === 3)  $value = $desk ? $fee['pickup_stopdesk'] : $fee['pickup_home'];
    else                  $value = $desk ? $fee['collection_stopdesk'] : $fee['collection_home'];
    json_ok([
        'found' => true, 'fee' => (float) $value,
        'return_fee' => (float) ($desk ? $fee['return_stopdesk'] : $fee['return_home']),
        'wilaya' => $fee['wilaya_name'],
    ]);
}
