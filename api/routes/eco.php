<?php
/**
 * Ecotrack (21 endpoint) + الجغرافيا المحلية + المزامنة
 */

function rt_ecotrack($method, $seg, $body) {
    $u = require_auth();
    $n1 = $seg[1] ?? '';
    $n2 = $seg[2] ?? '';

    switch ($n1) {
        case 'status':
            return eco_status_php();
        case 'test':
            if ($method !== 'POST') break;
            return eco_test_php($u, $body);
        case 'rate-limit':
            return json_ok(['data' => eco_rate_limit()['data'] ?? null]);
        case 'wilayas':
            return json_ok(['data' => eco_get_wilayas()['data'] ?? null]);
        case 'communes':
            return json_ok(['data' => eco_get_communes(param('wilaya_id'))['data'] ?? null]);
        case 'desks':
            return json_ok(['data' => eco_get_desks()['data'] ?? null]);
        case 'fees':
            return json_ok(['data' => eco_get_fees()['data'] ?? null]);
        case 'products':
            return json_ok(['data' => eco_get_products((int) (param('page') ?: 1))['data'] ?? null]);
        case 'orders':
            return json_ok(['data' => eco_get_orders([
                'page' => param('page'), 'start_date' => param('start_date'),
                'end_date' => param('end_date'), 'tracking' => param('tracking'),
            ])['data'] ?? null]);
        case 'orders-status':
            $t = array_values(array_filter(array_map('trim', explode(',', (string) param('trackings')))));
            return json_ok(['data' => eco_get_orders_status($t, param('status') ?: 'all')['data'] ?? null]);
        case 'tracking':
            return json_ok(['data' => eco_tracking_info($n2)['data'] ?? null]);
        case 'trackings':
            if ($method !== 'POST') break;
            $list = isset($body['trackings']) ? $body['trackings'] : [];
            if (!is_array($list)) $list = array_filter(array_map('trim', preg_split('/[\n,\s]+/', (string) $list)));
            if (!$list) throw new HttpError(400, 'أدخل رقم تتبع واحداً على الأقل');
            if (count($list) > 100) throw new HttpError(400, 'الحد الأقصى 100 رقم تتبع لكل نداء');
            return json_ok(['data' => eco_trackings_info(array_slice(array_values($list), 0, 100))['data'] ?? null]);
        case 'label':
            return eco_label_php($n2);
        case 'maj':
            if ($method === 'POST') {
                if (empty($body['tracking']) || empty($body['content'])) throw new HttpError(400, 'رقم التتبع والنص مطلوبان');
                $r = eco_add_maj($body['tracking'], $body['content']);
                log_activity($u['id'], $u['username'], 'ecotrack.addMaj', 'ecotrack', $body['tracking'], '', 1);
                return json_ok(['data' => $r['data'] ?? null]);
            }
            if ($n2) return json_ok(['data' => eco_get_maj($n2)['data'] ?? null]);
            break;
        case 'create-order':
            if ($method !== 'POST') break;
            $r = eco_create_order($body);
            log_activity($u['id'], $u['username'], 'ecotrack.createOrder', 'ecotrack', $body['tracking'] ?? '', '', 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'create-orders':
            if ($method !== 'POST') break;
            $orders = isset($body['orders']) && is_array($body['orders']) ? $body['orders'] : [];
            if (!$orders) throw new HttpError(400, 'لا توجد طلبيات');
            if (count($orders) > 100) throw new HttpError(400, 'الحد الأقصى 100 طلبية لكل نداء');
            $indexed = [];
            foreach (array_values($orders) as $i => $o) $indexed[(string) $i] = $o;
            $r = eco_create_orders($indexed);
            log_activity($u['id'], $u['username'], 'ecotrack.createOrders', 'ecotrack', '', count($orders) . ' طلبية', 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'update-order':
            if ($method !== 'POST') break;
            $r = eco_update_order($body);
            log_activity($u['id'], $u['username'], 'ecotrack.updateOrder', 'ecotrack', $body['tracking'] ?? '', '', 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'order':
            if ($method !== 'DELETE') break;
            $tracking = param('tracking');
            if (!$tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
            $r = eco_delete_order($tracking);
            log_activity($u['id'], $u['username'], 'ecotrack.deleteOrder', 'ecotrack', $tracking, '', 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'valid-order':
            if ($method !== 'POST') break;
            if (empty($body['tracking'])) throw new HttpError(400, 'رقم التتبع مطلوب');
            $r = eco_valid_order($body['tracking'], bool01($body['ask_collection'] ?? 0));
            log_activity($u['id'], $u['username'], 'ecotrack.validOrder', 'ecotrack', $body['tracking'], '', 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'valid-returns':
            if ($method !== 'POST') break;
            $trackings = isset($body['trackings']) ? (array) $body['trackings'] : [];
            if (!$trackings) throw new HttpError(400, 'أدخل رقم تتبع واحداً على الأقل');
            $r = eco_valid_returns($trackings);
            foreach ($trackings as $t) {
                $sh = q_one("SELECT order_id FROM shipments WHERE tracking = ?", [$t]);
                if ($sh) {
                    q_exec("UPDATE shipments SET ecotrack_status = 'retour_recu', synced_at = ? WHERE order_id = ?", [now(), $sh['order_id']]);
                    q_exec("UPDATE orders SET status = 'retour_recu', updated_at = ? WHERE id = ?", [now(), $sh['order_id']]);
                    record_event($sh['order_id'], $t, 'retour_recu', 'Return_received', ['details' => 'تأكيد استلام المرتجع', 'date' => today()]);
                }
            }
            log_activity($u['id'], $u['username'], 'ecotrack.validReturns', 'ecotrack', '', implode(',', $trackings), 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'ask-return':
            if ($method !== 'POST') break;
            if (empty($body['tracking'])) throw new HttpError(400, 'رقم التتبع مطلوب');
            $r = eco_ask_return($body['tracking']);
            log_activity($u['id'], $u['username'], 'ecotrack.askReturn', 'ecotrack', $body['tracking'], '', 1);
            return json_ok(['data' => $r['data'] ?? null]);
        case 'sync':
            return eco_sync_php($u, $n2, $body);
        case 'sync-history':
            return json_ok(['jobs' => q_all("SELECT * FROM sync_jobs ORDER BY id DESC LIMIT 30")]);
    }
    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}

/* ══════════════════════ حالة الاتصال ══════════════════════ */
function eco_status_php() {
    $c = eco_config();
    $validation = null;
    if (!empty($c['mock']) && !empty($c['token'])) {
        $r = eco_validate_token();
        $validation = ['ok' => true, 'data' => $r['data'] ?? null, 'mock' => true];
    } elseif (empty($c['mock'])) {
        try {
            $r = eco_validate_token();
            $validation = ['ok' => true, 'data' => $r['data'] ?? null, 'rate' => $r['rate'] ?? null];
        } catch (Exception $e) {
            $validation = ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    json_ok([
        'config' => [
            'base_url' => $c['base_url'],
            'api_token' => mask_token($c['token']),
            'has_token' => !empty($c['token']),
            'auth_mode' => $c['auth_mode'],
            'timeout' => $c['timeout'],
            'mock' => !empty($c['mock']),
            'configured' => !empty($c['configured']),
        ],
        'validation' => $validation,
        'counts' => [
            'wilayas' => (int) q_val("SELECT COUNT(*) AS c FROM wilayas", [], 0),
            'communes' => (int) q_val("SELECT COUNT(*) AS c FROM communes", [], 0),
            'desks' => (int) q_val("SELECT COUNT(*) AS c FROM desks", [], 0),
            'fees' => (int) q_val("SELECT COUNT(*) AS c FROM shipping_fees", [], 0),
            'products' => (int) q_val("SELECT COUNT(*) AS c FROM ecotrack_products", [], 0),
        ],
        'endpoints' => eco_order_types(),
    ]);
}

function eco_test_php($u, $body) {
    $override = null;
    if (!empty($body['base_url']) || !empty($body['api_token'])) {
        $override = [
            'base_url' => rtrim((string) ($body['base_url'] ?: eco_config()['base_url']), '/'),
            'token' => (string) ($body['api_token'] ?: eco_config()['token']),
            'auth_mode' => $body['auth_mode'] ?? (eco_config()['auth_mode'] ?: 'both'),
            'timeout' => 20000,
            'mock' => false,
            'configured' => true,
        ];
    }
    try {
        $r = eco_validate_token($override);
        log_activity($u['id'], $u['username'], 'ecotrack.test', 'settings', '', 'VALID_TOKEN', 1);
        json_ok(['data' => $r['data'] ?? null, 'rate' => $r['rate'] ?? null, 'mock' => !empty($r['mock'])]);
    } catch (Exception $e) {
        log_activity($u['id'], $u['username'], 'ecotrack.test', 'settings', '', $e->getMessage(), 0);
        json_out(['ok' => false, 'error' => $e->getMessage(), 'code' => $e instanceof EcotrackError ? $e->ecode : null], 422);
    }
}

function eco_label_php($tracking) {
    if (!$tracking) throw new HttpError(400, 'رقم التتبع مطلوب');
    $r = eco_order_label($tracking);
    header('Content-Type: ' . ($r['content_type'] ?: 'application/pdf'));
    $dispo = param('download') === '1' ? 'attachment' : 'inline';
    header("Content-Disposition: $dispo; filename=\"label-$tracking.pdf\"");
    echo $r['buffer'];
    exit;
}

/* ══════════════════════ المزامنة ══════════════════════ */
function sync_job_start($kind) {
    // تنظيف السجل القديم (أكثر من 60 إدخالاً)
    $old = q_all("SELECT id FROM sync_jobs ORDER BY id DESC LIMIT 200 OFFSET 60");
    foreach ($old as $row) q_exec("DELETE FROM sync_jobs WHERE id = ?", [$row['id']]);
    $r = q_exec("INSERT INTO sync_jobs (kind, status, message, count, started_at) VALUES (?, 'running', '', 0, ?)", [$kind, now()]);
    return $r['id'];
}
function sync_job_end($id, $status, $message = '', $count = 0) {
    q_exec("UPDATE sync_jobs SET status = ?, message = ?, count = ?, finished_at = ? WHERE id = ?", [$status, $message, $count, now(), $id]);
}

function eco_sync_php($u, $kind, $body) {
    try {
        switch ($kind) {
            case 'wilayas':  $res = do_sync_wilayas($u);  break;
            case 'communes': $res = do_sync_communes($u, $body); break;
            case 'desks':    $res = do_sync_desks($u);    break;
            case 'fees':     $res = do_sync_fees($u);     break;
            case 'products': $res = do_sync_products($u, $body); break;
            case 'all':      $res = do_sync_all($u, $body); break;
            default: throw new HttpError(404, 'نوع مزامنة غير معروف', 'NOT_FOUND');
        }
        json_ok($res);
    } catch (Exception $e) {
        json_out(['ok' => false, 'error' => $e->getMessage()], 422);
    }
}

function do_sync_wilayas($u) {
    $job = sync_job_start('wilayas');
    try {
        $r = eco_get_wilayas();
        $list = eco_normalize_wilayas($r['data'] ?? null);
        if (!$list) throw new HttpError(422, 'استجابة فارغة من Ecotrack');
        q_exec("UPDATE wilayas SET active = 0", []);
        foreach ($list as $w) {
            $exists = q_one("SELECT wilaya_id FROM wilayas WHERE wilaya_id = ?", [$w['wilaya_id']]);
            if ($exists) {
                q_exec("UPDATE wilayas SET name_fr = ?, active = 1, synced_at = ? WHERE wilaya_id = ?", [$w['name'], now(), $w['wilaya_id']]);
            } else {
                q_exec("INSERT INTO wilayas (wilaya_id, name_fr, name_ar, active, synced_at) VALUES (?, ?, '', 1, ?)", [$w['wilaya_id'], $w['name'], now()]);
            }
        }
        sync_job_end($job, 'success', count($list) . ' ولاية', count($list));
        log_activity($u['id'], $u['username'], 'sync.wilayas', 'ecotrack', '', (string) count($list), 1);
        return ['count' => count($list), 'mock' => !empty($r['mock'])];
    } catch (Exception $e) {
        sync_job_end($job, 'failed', $e->getMessage());
        throw $e;
    }
}

function do_sync_communes($u, $body) {
    $job = sync_job_start('communes');
    $wid = !empty($body['wilaya_id']) ? intval0($body['wilaya_id']) : 0;
    $targets = $wid ? [$wid] : array_map(function ($r) { return (int) $r['wilaya_id']; },
        q_all("SELECT wilaya_id FROM wilayas WHERE active = 1 ORDER BY wilaya_id"));
    if (!$targets) $targets = range(1, 58);
    $count = 0;
    $errors = [];
    foreach ($targets as $w) {
        try {
            $r = eco_get_communes($w);
            $list = eco_normalize_communes($r['data'] ?? null);
            if ($list) {
                q_exec("DELETE FROM communes WHERE wilaya_id = ?", [$w]);
                $hasDesk = false;
                foreach ($list as $c) {
                    insert_ignore('communes', ['wilaya_id' => $w, 'name' => $c['name'],
                        'code_postal' => $c['code_postal'], 'has_stop_desk' => $c['has_stop_desk']]);
                    if (!empty($c['has_stop_desk'])) $hasDesk = true;
                    $count++;
                }
                if ($hasDesk) q_exec("UPDATE wilayas SET has_stop_desk = 1, synced_at = ? WHERE wilaya_id = ?", [now(), $w]);
            }
        } catch (Exception $e) {
            $errors[] = "ولاية $w: " . $e->getMessage();
        }
        usleep(120000);
    }
    sync_job_end($job, $errors ? 'partial' : 'success', implode(' | ', $errors), $count);
    log_activity($u['id'], $u['username'], 'sync.communes', 'ecotrack', '', "$count بلدية", $errors ? 0 : 1);
    return ['count' => $count, 'errors' => $errors];
}

function do_sync_desks($u) {
    $job = sync_job_start('desks');
    try {
        $r = eco_get_desks();
        $payload = $r['data'] ?: [];
        q_exec("DELETE FROM desks", []);
        $count = 0;
        $my = $payload['my_desk'] ?? null;
        if ($my) {
            $loc = $my['location'] ?? [];
            q_exec("INSERT INTO desks (hub_id, name, wilaya, commune, address, phone, phone2, email, map, hours, is_my_desk)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
                [(string) ($my['hub_id'] ?? ''), $my['hub_name'] ?? '', $loc['wilaya'] ?? '', $loc['commune'] ?? '',
                 $loc['adresse'] ?? '', $loc['phone'] ?? '', $loc['phone2'] ?? '', $loc['email'] ?? '',
                 $loc['map'] ?? '', json_encode($my['working_hours'] ?? [], JSON_UNESCAPED_UNICODE)]);
            $count++;
        }
        foreach (($payload['other_desks'] ?? []) as $d) {
            q_exec("INSERT INTO desks (hub_id, name, wilaya, commune, address, phone, phone2, email, map, hours, is_my_desk)
                    VALUES ('', ?, ?, ?, ?, ?, ?, '', ?, '', 0)",
                [$d['name'] ?? '', $d['wilaya'] ?? '', $d['commune'] ?? '', $d['adresse'] ?? '',
                 $d['phone'] ?? '', $d['phone2'] ?? '', $d['map'] ?? '']);
            $count++;
        }
        sync_job_end($job, 'success', "$count مكتب", $count);
        log_activity($u['id'], $u['username'], 'sync.desks', 'ecotrack', '', (string) $count, 1);
        return ['count' => $count, 'mock' => !empty($r['mock'])];
    } catch (Exception $e) {
        sync_job_end($job, 'failed', $e->getMessage());
        throw $e;
    }
}

function do_sync_fees($u) {
    $job = sync_job_start('fees');
    try {
        $r = eco_get_fees();
        $list = eco_normalize_fees($r['data'] ?? null);
        if (!$list) throw new HttpError(422, 'استجابة فارغة من Ecotrack');
        foreach ($list as $f) {
            upsert('shipping_fees', [
                'wilaya_id' => $f['wilaya_id'], 'wilaya_name' => $f['wilaya_name'],
                'delivery_home' => $f['delivery_home'], 'delivery_stopdesk' => $f['delivery_stopdesk'],
                'pickup_home' => $f['pickup_home'], 'pickup_stopdesk' => $f['pickup_stopdesk'],
                'exchange_home' => $f['exchange_home'], 'exchange_stopdesk' => $f['exchange_stopdesk'],
                'collection_home' => $f['collection_home'], 'collection_stopdesk' => $f['collection_stopdesk'],
                'return_home' => $f['return_home'], 'return_stopdesk' => $f['return_stopdesk'],
                'raw' => json_encode($f['raw'], JSON_UNESCAPED_UNICODE), 'synced_at' => now(),
            ], ['wilaya_name','delivery_home','delivery_stopdesk','pickup_home','pickup_stopdesk','exchange_home',
                'exchange_stopdesk','collection_home','collection_stopdesk','return_home','return_stopdesk','raw','synced_at']);
        }
        sync_job_end($job, 'success', count($list) . ' ولاية', count($list));
        log_activity($u['id'], $u['username'], 'sync.fees', 'ecotrack', '', (string) count($list), 1);
        return ['count' => count($list), 'mock' => !empty($r['mock'])];
    } catch (Exception $e) {
        sync_job_end($job, 'failed', $e->getMessage());
        throw $e;
    }
}

function do_sync_products($u, $body) {
    $job = sync_job_start('products');
    $maxPages = max(1, min(20, intval0($body['pages'] ?? 3, 3)));
    $count = 0;
    try {
        for ($p = 1; $p <= $maxPages; $p++) {
            $r = eco_get_products($p);
            $payload = $r['data'] ?: [];
            $list = $payload['products'] ?? (isset($payload[0]) ? $payload : []);
            if (!$list) break;
            foreach ($list as $prod) {
                upsert('ecotrack_products', [
                    'reference' => (string) ($prod['reference'] ?? ''),
                    'barcode' => (string) ($prod['barcode'] ?? ''),
                    'title' => (string) ($prod['title'] ?? ''),
                    'is_active' => bool01($prod['is_active'] ?? 1),
                    'image' => (string) ($prod['image'] ?? ''),
                    'stock_disponible' => intval0($prod['stock_disponible'] ?? 0),
                    'stock_reserve' => intval0($prod['stock_reserve'] ?? 0),
                    'stock_phisique' => intval0($prod['stock_phisique'] ?? 0),
                    'synced_at' => now(),
                ], ['barcode','title','is_active','image','stock_disponible','stock_reserve','stock_phisique','synced_at']);
                $count++;
            }
            $lastPage = (int) ($payload['pagination']['last_page'] ?? 1);
            if ($p >= $lastPage) break;
            usleep(120000);
        }
        sync_job_end($job, 'success', "$count منتج", $count);
        log_activity($u['id'], $u['username'], 'sync.products', 'ecotrack', '', (string) $count, 1);
        return ['count' => $count];
    } catch (Exception $e) {
        sync_job_end($job, 'failed', $e->getMessage());
        throw $e;
    }
}

function do_sync_all($u, $body) {
    $report = [];
    $steps = [
        'wilayas'  => function ($u) { return do_sync_wilayas($u); },
        'desks'    => function ($u) { return do_sync_desks($u); },
        'fees'     => function ($u) { return do_sync_fees($u); },
    ];
    foreach ($steps as $k => $fn) {
        try { $report[$k] = ['ok' => true, 'result' => $fn($u)]; }
        catch (Exception $e) { $report[$k] = ['ok' => false, 'error' => $e->getMessage()]; }
    }
    if (!empty($body['communes'])) {
        try { $report['communes'] = ['ok' => true, 'result' => do_sync_communes($u, [])]; }
        catch (Exception $e) { $report['communes'] = ['ok' => false, 'error' => $e->getMessage()]; }
    }
    if (!empty($body['products'])) {
        try { $report['products'] = ['ok' => true, 'result' => do_sync_products($u, $body)]; }
        catch (Exception $e) { $report['products'] = ['ok' => false, 'error' => $e->getMessage()]; }
    }
    log_activity($u['id'], $u['username'], 'sync.all', 'ecotrack', '', '', 1);
    return ['report' => $report];
}

/* ══════════════════════ الجغرافيا المحلية ══════════════════════ */
function rt_geo($method, $seg, $body) {
    require_auth();
    $n1 = $seg[1] ?? '';
    switch ($n1) {
        case 'wilayas':
            json_ok(['wilayas' => q_all("SELECT * FROM wilayas WHERE active = 1 ORDER BY wilaya_id")]);
        case 'communes':
            $wid = param('wilaya_id');
            if ($wid) json_ok(['communes' => q_all("SELECT * FROM communes WHERE wilaya_id = ? ORDER BY name", [intval0($wid)])]);
            json_ok(['communes' => q_all("SELECT * FROM communes ORDER BY wilaya_id, name")]);
        case 'desks':
            $wid = param('wilaya_id');
            if ($wid) {
                $w = q_one("SELECT name_fr FROM wilayas WHERE wilaya_id = ?", [intval0($wid)]);
                json_ok(['desks' => $w ? q_all("SELECT * FROM desks WHERE wilaya = ? ORDER BY name", [$w['name_fr']]) : []]);
            }
            json_ok(['desks' => q_all("SELECT * FROM desks ORDER BY is_my_desk DESC, name")]);
        case 'fees':
            $wid = param('wilaya_id');
            if ($wid) json_ok(['fees' => q_all("SELECT * FROM shipping_fees WHERE wilaya_id = ?", [intval0($wid)])]);
            json_ok(['fees' => q_all("SELECT * FROM shipping_fees ORDER BY wilaya_id")]);
        case 'products':
            json_ok(['products' => q_all("SELECT * FROM ecotrack_products ORDER BY reference")]);
        case 'bootstrap':
            json_ok([
                'wilayas' => q_all("SELECT * FROM wilayas WHERE active = 1 ORDER BY wilaya_id"),
                'communes' => q_all("SELECT wilaya_id, name, code_postal, has_stop_desk FROM communes ORDER BY wilaya_id, name"),
                'desks' => q_all("SELECT id, name, wilaya, commune, address, phone FROM desks ORDER BY name"),
                'fees' => q_all("SELECT * FROM shipping_fees ORDER BY wilaya_id"),
            ]);
    }
    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}
