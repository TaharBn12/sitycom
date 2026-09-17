<?php
/**
 * ═══════════════════════════════════════════════════════════
 *  عميل Ecotrack API v1 — 21 endpoint
 *  https://documenter.getpostman.com/view/14517169/Tz5je15g
 * ═══════════════════════════════════════════════════════════
 */

class EcotrackError extends Exception {
    public $ecode;
    public $estatus;
    public $errors;
    public $payload;
    public function __construct($message, $code = null, $status = null, $errors = null, $payload = null) {
        parent::__construct($message);
        $this->ecode = $code;
        $this->estatus = $status;
        $this->errors = $errors;
        $this->payload = $payload;
    }
}

function eco_error_codes() {
    return [
        10001 => 'الطلبية غير قابلة للتعديل (تمت مصادقتها/شحنها)',
        10002 => 'لا يوجد توصيل للولاية المختارة',
        10003 => 'لا يمكن طلب الإرجاع لهذه الطلبية',
    ];
}

function eco_statuses() {
    return ['prete_a_expedier','en_ramassage','en_preparation_stock','vers_hub','en_hub','vers_wilaya',
        'en_preparation','en_livraison','suspendu','livre_non_encaisse','encaisse_non_paye','paiements_prets',
        'paye_et_archive','retour_chez_livreur','retour_transit_entrepot','retour_en_traitement','retour_recu',
        'retour_archive','annule','all'];
}

function eco_activities() {
    return ['order_information_received_by_carrier','notification_on_order','picked','accepted_by_carrier',
        'dispatched_to_driver','attempt_delivery','return_asked','return_in_transit','Return_received',
        'livred','encaissed','payed'];
}

function eco_order_types() {
    return [
        ['id' => 1, 'ar' => 'توصيل', 'fr' => 'Livraison', 'en' => 'Delivery'],
        ['id' => 2, 'ar' => 'تبديل (Échange)', 'fr' => 'Échange', 'en' => 'Exchange'],
        ['id' => 3, 'ar' => 'استلام (Pickup)', 'fr' => 'PICKUP', 'en' => 'Pickup'],
        ['id' => 4, 'ar' => 'تحصيل (Recouvrement)', 'fr' => 'Recouvrement', 'en' => 'Collection'],
    ];
}

/** الإعدادات الحالية (من قاعدة البيانات + ملف الإعدادات) */
function eco_config($override = null) {
    static $cache = null;
    if ($cache === null) {
        $db = setting('ecotrack', []);
        if (!is_array($db)) $db = [];
        $baseUrl = isset($db['base_url']) ? trim((string) $db['base_url']) : '';
        $token   = isset($db['api_token']) ? trim((string) $db['api_token']) : '';
        if ($baseUrl === '') $baseUrl = trim((string) cfg('ecotrack.base_url'));
        if ($token === '')   $token   = trim((string) cfg('ecotrack.api_token'));
        $mockEnv = cfg('ecotrack.mock');
        $configured = $baseUrl !== '' && $token !== '';
        $cache = [
            'base_url'  => rtrim($baseUrl, '/'),
            'token'     => $token,
            'auth_mode' => isset($db['auth_mode']) && $db['auth_mode'] ? $db['auth_mode'] : (cfg('ecotrack.auth_mode') ?: 'both'),
            'timeout'   => (int) (isset($db['timeout']) && $db['timeout'] ? $db['timeout'] : (cfg('ecotrack.timeout') ?: 20000)),
            'mock'      => $mockEnv === true || $mockEnv === 1 || $mockEnv === '1' || (isset($db['mock']) && $db['mock']) || !$configured,
            'configured'=> $configured,
        ];
    }
    return $override ? array_merge($cache, $override) : $cache;
}

function eco_is_mock() {
    $c = eco_config();
    return !empty($c['mock']);
}

/* ══════════════════════ الطلب الأساسي ══════════════════════ */
function eco_build_query($params) {
    $parts = [];
    foreach ($params as $k => $v) {
        if ($v === null || $v === '' || $v === false) continue;
        if (is_array($v)) {
            foreach ($v as $item) $parts[] = rawurlencode($k) . '=' . rawurlencode((string) $item);
        } else {
            $parts[] = rawurlencode($k) . '=' . rawurlencode((string) $v);
        }
    }
    return implode('&', $parts);
}

function eco_request($method, $path, $query = [], $body = null, $raw = false, $cfg = null) {
    $c = $cfg ?: eco_config();
    if (!empty($c['mock'])) return eco_mock($method, $path, $query, $body);
    if ($c['base_url'] === '' || $c['token'] === '') {
        throw new EcotrackError('إعدادات Ecotrack غير مكتملة: أدخل الرابط الأساسي والتوكن من شاشة «التوصيل ← لوحة الشحن».', 'NOT_CONFIGURED');
    }

    $params = $query ?: [];
    $mustQuery = in_array($path, ['/api/v1/validate/token', '/api/v1/get/orders/status'], true);
    if ($mustQuery || $c['auth_mode'] !== 'bearer') $params['api_token'] = $c['token'];

    // trackings[] يجب أن تُرسل بهذا الشكل
    $qs = '';
    foreach ($params as $k => $v) {
        if ($v === null || $v === '' || $v === false) continue;
        if (is_array($v)) {
            foreach ($v as $item) $qs .= '&' . rawurlencode($k) . '=' . rawurlencode((string) $item);
        } else {
            $qs .= '&' . rawurlencode($k) . '=' . rawurlencode((string) $v);
        }
    }
    $url = $c['base_url'] . $path . ($qs ? '?' . substr($qs, 1) : '');

    if (!function_exists('curl_init')) {
        throw new EcotrackError('امتداد cURL غير مفعّل على الخادم — لا يمكن الاتصال بـ Ecotrack.', 'NO_CURL');
    }

    $headers = ['Accept: application/json'];
    if ($c['auth_mode'] === 'both' || $c['auth_mode'] === 'bearer') $headers[] = 'Authorization: Bearer ' . $c['token'];
    $payload = null;
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        $payload = json_encode($body, JSON_UNESCAPED_UNICODE);
    }

    $respHeaders = [];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => max(5, (int) ceil($c['timeout'] / 1000)),
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_HEADERFUNCTION => function ($curl, $header) use (&$respHeaders) {
            $len = strlen($header);
            $parts = explode(':', $header, 2);
            if (count($parts) === 2) $respHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
            return $len;
        },
    ]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);

    $text = curl_exec($ch);
    $err  = curl_error($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    if ($text === false) {
        throw new EcotrackError('تعذّر الاتصال بـ Ecotrack: ' . ($err ?: 'خطأ غير معروف'), 'NETWORK');
    }

    if ($raw) {
        $data = json_decode($text, true);
        if ($code === 200 && is_array($data) && isset($data['success']) && $data['success'] === false) {
            eco_throw($code, $data, $text);
        }
        return ['ok' => true, 'status' => $code, 'content_type' => $ctype ?: 'application/pdf', 'buffer' => $text];
    }

    $data = json_decode($text, true);
    if ($code < 200 || $code >= 300) eco_throw($code, is_array($data) ? $data : null, $text);
    if (is_array($data) && isset($data['success']) && $data['success'] === false) eco_throw($code, $data, $text);

    return ['ok' => true, 'status' => $code, 'data' => $data, 'rate' => eco_rate_headers($respHeaders)];
}

function eco_rate_headers($h) {
    $keys = ['x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-limit-day','x-ratelimit-remaining-day',
             'x-ratelimit-limit-hour','x-ratelimit-remaining-hour','x-ratelimit-reset-day','retry-after'];
    $found = false;
    foreach ($keys as $k) { if (isset($h[$k])) { $found = true; break; } }
    if (!$found) return null;
    return [
        'limit' => $h['x-ratelimit-limit'] ?? null,
        'remaining' => $h['x-ratelimit-remaining'] ?? null,
        'limitDay' => $h['x-ratelimit-limit-day'] ?? null,
        'remainingDay' => $h['x-ratelimit-remaining-day'] ?? null,
        'limitHour' => $h['x-ratelimit-limit-hour'] ?? null,
        'remainingHour' => $h['x-ratelimit-remaining-hour'] ?? null,
        'resetDay' => $h['x-ratelimit-reset-day'] ?? null,
        'retryAfter' => $h['retry-after'] ?? null,
    ];
}

function eco_throw($status, $data, $text) {
    if ($status === 429) {
        throw new EcotrackError('تم تجاوز حد الطلبات (50 طلب/دقيقة). أعد المحاولة بعد قليل.', 'RATE_LIMIT', $status, null, $data);
    }
    if ($status === 422 && is_array($data)) {
        $msgs = [];
        if (isset($data['errors']) && is_array($data['errors'])) {
            foreach ($data['errors'] as $field => $arr) {
                foreach ((array) $arr as $m) $msgs[] = "$field: $m";
            }
        }
        throw new EcotrackError(implode(' | ', $msgs) ?: ($data['message'] ?? 'بيانات غير صالحة (422)'), 'VALIDATION', $status, $data['errors'] ?? null, $data);
    }
    if (is_array($data) && isset($data['success']) && $data['success'] === false) {
        $codes = eco_error_codes();
        $err = $data['error'] ?? null;
        throw new EcotrackError($codes[$err] ?? ($data['message'] ?? 'فشل الطلب'), $err, $status, null, $data);
    }
    if (is_array($data) && isset($data['message'])) {
        throw new EcotrackError((string) $data['message'], $status, $status, null, $data);
    }
    throw new EcotrackError($text ?: "خطأ غير متوقع (HTTP $status)", $status, $status, null, $data);
}

/* ══════════════════════ الـ 21 Endpoint ══════════════════════ */
function eco_validate_token($cfg = null) { return eco_request('GET', '/api/v1/validate/token', [], null, false, $cfg); }
function eco_rate_limit($cfg = null)     { return eco_request('GET', '/api/v1/', [], null, false, $cfg); }
function eco_create_order($p, $cfg = null)      { return eco_request('POST', '/api/v1/create/order', $p, null, false, $cfg); }
function eco_create_orders($orders, $cfg = null){ return eco_request('POST', '/api/v1/create/orders', [], ['orders' => $orders], false, $cfg); }
function eco_update_order($p, $cfg = null)      { return eco_request('POST', '/api/v1/update/order', $p, null, false, $cfg); }
function eco_delete_order($tracking, $cfg = null){ return eco_request('DELETE', '/api/v1/delete/order', ['tracking' => $tracking], null, false, $cfg); }
function eco_valid_order($tracking, $ask = 0, $cfg = null) { return eco_request('POST', '/api/v1/valid/order', ['tracking' => $tracking, 'ask_collection' => $ask], null, false, $cfg); }
function eco_valid_returns($trackings, $cfg = null) { return eco_request('POST', '/api/v1/valid/returns', [], ['trackings' => array_values((array) $trackings)], false, $cfg); }
function eco_order_label($tracking, $cfg = null) { return eco_request('GET', '/api/v1/get/order/label', ['tracking' => $tracking], null, true, $cfg); }
function eco_add_maj($tracking, $content, $cfg = null) { return eco_request('POST', '/api/v1/add/maj', ['tracking' => $tracking, 'content' => $content], null, false, $cfg); }
function eco_get_maj($tracking, $cfg = null) { return eco_request('GET', '/api/v1/get/maj', ['tracking' => $tracking], null, false, $cfg); }
function eco_ask_return($tracking, $cfg = null) { return eco_request('POST', '/api/v1/ask/for/order/return', ['tracking' => $tracking], null, false, $cfg); }
function eco_tracking_info($tracking, $cfg = null) { return eco_request('GET', '/api/v1/get/tracking/info', ['tracking' => $tracking], null, false, $cfg); }
function eco_trackings_info($trackings, $cfg = null) { return eco_request('GET', '/api/v1/get/trackings/info', ['trackings[]' => array_values((array) $trackings)], null, false, $cfg); }
function eco_get_orders($args = [], $cfg = null) { return eco_request('GET', '/api/v1/get/orders', $args, null, false, $cfg); }
function eco_get_orders_status($trackings, $status = 'all', $cfg = null) {
    return eco_request('GET', '/api/v1/get/orders/status', [
        'trackings' => is_array($trackings) ? implode(',', $trackings) : $trackings,
        'status' => $status ?: 'all',
    ], null, false, $cfg);
}
function eco_get_wilayas($cfg = null)  { return eco_request('GET', '/api/v1/get/wilayas', [], null, false, $cfg); }
function eco_get_desks($cfg = null)    { return eco_request('GET', '/api/v1/get/desks', [], null, false, $cfg); }
function eco_get_communes($wid = null, $cfg = null) { return eco_request('GET', '/api/v1/get/communes', ['wilaya_id' => $wid], null, false, $cfg); }
function eco_get_fees($cfg = null)     { return eco_request('GET', '/api/v1/get/fees', [], null, false, $cfg); }
function eco_get_products($page = 1, $cfg = null) { return eco_request('GET', '/api/v1/get/products/list', ['page' => $page], null, false, $cfg); }

/* ══════════════════════ المحوّلات ══════════════════════ */
function eco_normalize_fees($response) {
    $list = is_array($response) ? (isset($response[0]) ? $response : ($response['data'] ?? [])) : [];
    $out = [];
    foreach ((array) $list as $f) {
        $n = function ($x) { return (float) preg_replace('/[^\d.-]/', '', (string) ($x ?? '0')); };
        $out[] = [
            'wilaya_id' => (int) ($f['wilaya_id'] ?? 0),
            'wilaya_name' => $f['wilaya_name'] ?? ($f['name'] ?? ''),
            'delivery_home' => $n($f['livraison']['tarif'] ?? ($f['tarif'] ?? 0)),
            'delivery_stopdesk' => $n($f['livraison']['tarif_stopdesk'] ?? ($f['tarif_stopdesk'] ?? 0)),
            'pickup_home' => $n($f['pickup']['tarif'] ?? 0),
            'pickup_stopdesk' => $n($f['pickup']['tarif_stopdesk'] ?? 0),
            'exchange_home' => $n($f['echange']['tarif'] ?? 0),
            'exchange_stopdesk' => $n($f['echange']['tarif_stopdesk'] ?? 0),
            'collection_home' => $n($f['recouvrement']['tarif'] ?? 0),
            'collection_stopdesk' => $n($f['recouvrement']['tarif_stopdesk'] ?? 0),
            'return_home' => $n($f['retour']['tarif'] ?? 0),
            'return_stopdesk' => $n($f['retour']['tarif_stopdesk'] ?? 0),
            'raw' => $f,
        ];
    }
    return $out;
}

function eco_normalize_communes($response) {
    $rows = [];
    if (is_array($response)) {
        $obj = isset($response[0]) ? $response : ($response['data'] ?? $response);
        foreach ((array) $obj as $c) {
            if (!is_array($c) || empty($c['nom']) && empty($c['name'])) continue;
            $rows[] = [
                'wilaya_id' => (int) ($c['wilaya_id'] ?? 0),
                'name' => $c['nom'] ?? ($c['name'] ?? ''),
                'code_postal' => (string) ($c['code_postal'] ?? ''),
                'has_stop_desk' => !empty($c['has_stop_desk']) ? 1 : 0,
            ];
        }
    }
    return $rows;
}

function eco_normalize_wilayas($response) {
    $list = is_array($response) ? (isset($response[0]) ? $response : ($response['data'] ?? [])) : [];
    $out = [];
    foreach ((array) $list as $w) {
        $id = (int) ($w['wilaya_id'] ?? ($w['id'] ?? 0));
        if (!$id) continue;
        $out[] = ['wilaya_id' => $id, 'name' => $w['wilaya_name'] ?? ($w['name'] ?? '')];
    }
    return $out;
}

/* ══════════════════════ الوضع التجريبي (Mock) ══════════════════════ */
function eco_mock_tracking($seed = '') {
    $h = 0;
    foreach (str_split((string) $seed) as $ch) $h = ($h * 31 + ord($ch)) % 1000000000000;
    return 'EC' . substr((string) (100000000000 + $h), 0, 12);
}

function eco_mock_activity($tracking, $steps = 3) {
    $seq = ['order_information_received_by_carrier','picked','accepted_by_carrier','vers_hub','dispatched_to_driver','attempt_delivery','livred'];
    $out = [];
    $base = time() - ($steps * 86400);
    for ($i = 0; $i < min($steps, count($seq)); $i++) {
        $t = $base + ($i * 86400);
        $out[] = [
            'date' => date('Y-m-d', $t),
            'time' => date('H:i:s', $t),
            'status' => $seq[$i],
            'station' => $i > 1 ? 'HUB Alger' : '',
            'scanLocation' => $i > 1 ? 'HUB' : '',
        ];
    }
    return $out;
}

function eco_mock_rate() {
    return ['limit' => '50', 'remaining' => (string) (49 - (time() % 20)), 'limitDay' => '15000',
        'remainingDay' => '14870', 'limitHour' => '1500', 'remainingHour' => '1470'];
}

function eco_mock($method, $path, $query = [], $body = null) {
    $q = is_array($query) ? $query : [];
    $ok = function ($data) { return ['ok' => true, 'status' => 200, 'data' => $data, 'rate' => eco_mock_rate(), 'mock' => true]; };

    switch ($path) {
        case '/api/v1/validate/token':
            return $ok(['success' => true, 'message' => 'VALID_TOKEN']);

        case '/api/v1/':
            return $ok(['message' => 'Rate limit: 50/min, 1500/hour, 15000/day (mode démo)']);

        case '/api/v1/create/order':
            return $ok(['success' => true, 'tracking' => eco_mock_tracking($q['reference'] ?? ($q['nom_client'] ?? time()))]);

        case '/api/v1/create/orders':
            $results = [];
            $orders = is_array($body) && isset($body['orders']) ? $body['orders'] : [];
            $i = 0;
            foreach ($orders as $o) {
                $key = !empty($o['reference']) ? $o['reference'] : (string) $i;
                if (empty($o['telephone']) || strlen((string) $o['telephone']) < 9) {
                    $results[$key] = ['telephone' => ['Le champ téléphone est obligatoire. (démo)']];
                } elseif ((int) ($o['code_wilaya'] ?? 0) === 12) {
                    $results[$key] = ['success' => false, 'error' => 10002, 'message' => 'Pas de livraison pour la wilaya sélectionnée'];
                } else {
                    $results[$key] = ['success' => true, 'tracking' => eco_mock_tracking($o['reference'] ?? $i)];
                }
                $i++;
            }
            return $ok(['success' => true, 'results' => $results]);

        case '/api/v1/update/order':
            return $ok(['success' => true, 'message' => 'Commande modifiée avec succès']);

        case '/api/v1/delete/order':
            return $ok(['success' => true, 'message' => 'Commande supprimée']);

        case '/api/v1/valid/order':
            return $ok(['success' => true, 'message' => 'Commande expedier avec succès']);

        case '/api/v1/valid/returns':
            $arr = is_array($body) && isset($body['trackings']) ? $body['trackings'] : [];
            return $ok(['returned' => count($arr) ? 'success' : 'fail']);

        case '/api/v1/get/order/label':
            return ['ok' => true, 'status' => 200, 'content_type' => 'application/pdf',
                'buffer' => eco_mock_pdf($q['tracking'] ?? 'EC000000000000'), 'rate' => eco_mock_rate(), 'mock' => true];

        case '/api/v1/add/maj':
            return $ok(['success' => true, 'message' => 'Mise a jour avec success']);

        case '/api/v1/get/maj':
            return $ok([
                ['remarque' => 'Sitycom (démo) : ' . ($q['content'] ?? ''), 'station' => '', 'livreur' => '',
                 'created_at' => date('Y-m-d H:i:s'), 'tracking' => $q['tracking'] ?? ''],
                ['remarque' => 'تمت محاولة التوصيل — الزبون غير متواجد', 'station' => 'HUB Alger',
                 'livreur' => 'Livreur Démo', 'created_at' => date('Y-m-d H:i:s', time() - 86400),
                 'tracking' => $q['tracking'] ?? ''],
            ]);

        case '/api/v1/ask/for/order/return':
            return $ok(['success' => true, 'message' => 'Retour demandé avec succès']);

        case '/api/v1/get/tracking/info':
            $t = $q['tracking'] ?? 'EC000000000000';
            return $ok([
                'recipientName' => 'زبون تجريبي', 'shippedBy' => 'Sitycom (démo)',
                'originCity' => 16, 'destLocationCity' => 16, 'currentStation' => 'Alger',
                'activity' => eco_mock_activity($t, 5), 'reasons' => [], 'status' => 'En livraison',
            ]);

        case '/api/v1/get/trackings/info':
            $list = isset($q['trackings[]']) ? (array) $q['trackings[]'] : [];
            $out = [];
            foreach (array_values($list) as $i => $t) {
                $out[] = ['tracking' => $t,
                    'status' => ['En livraison', 'En hub', 'Prêt à expédier', 'Livre non encaissé'][$i % 4],
                    'activity' => eco_mock_activity($t, 3)];
            }
            return $ok($out);

        case '/api/v1/get/orders':
            $statuses = ['prete_a_expedier','en_livraison','en_hub','livre_non_encaisse','retour_en_traitement'];
            $wilayas = geo_wilayas();
            $communes = geo_communes();
            $rows = [];
            for ($i = 0; $i < 12; $i++) {
                $w = $wilayas[($i * 7) % count($wilayas)];
                $wid = (int) $w['wilaya_id'];
                $rows[] = [
                    'tracking' => eco_mock_tracking('demo' . $i),
                    'reference' => 'CMD-2026-' . (1000 + $i),
                    'client' => ['أحمد بن علي','سارة مزياني','يوسف قاسمي','نورة بوعزيز'][$i % 4],
                    'phone' => '05501234' . (10 + $i), 'phone_2' => null,
                    'adresse' => '17 Rue de la Liberté',
                    'commune' => $communes[$wid][0] ?? 'Centre',
                    'wilaya_id' => $wid,
                    'montant' => (string) (3000 + $i * 750),
                    'tarif_prestation' => (string) (600 + ($i % 5) * 100),
                    'tarif_retour' => '300', 'type_id' => 1,
                    'created_at' => date('Y-m-d', time() - ($i * 86400)),
                    'payment_id' => 300 + $i, 'return_id' => null,
                    'status' => $statuses[$i % count($statuses)],
                    'products' => 'منتج تجريبي x1',
                ];
            }
            return $ok(['current_page' => (int) ($q['page'] ?? 1), 'data' => $rows, 'per_page' => 40, 'total' => 120, 'last_page' => 10]);

        case '/api/v1/get/orders/status':
            $list = array_filter(array_map('trim', explode(',', (string) ($q['trackings'] ?? ''))));
            $data = [];
            $i = 0;
            foreach ($list as $t) {
                $data[$t] = ['tracking' => $t,
                    'status' => ['en_livraison','en_hub','prete_a_expedier'][$i % 3],
                    'activity' => eco_mock_activity($t, 2)];
                $i++;
            }
            return $ok(['success' => true, 'data' => $data]);

        case '/api/v1/get/wilayas':
            $out = [];
            foreach (geo_wilayas() as $w) $out[] = ['wilaya_id' => (int) $w['wilaya_id'], 'wilaya_name' => $w['name_fr']];
            return $ok($out);

        case '/api/v1/get/desks':
            $others = [];
            foreach (array_slice(geo_wilayas(), 0, 20) as $w) {
                $wid = (int) $w['wilaya_id'];
                $communes = geo_communes();
                $others[] = ['name' => 'Station ' . $w['name_fr'], 'phone' => '0550 11 22 33', 'phone2' => null,
                    'code_wilaya' => (string) $wid, 'wilaya' => $w['name_fr'],
                    'commune' => $communes[$wid][0] ?? $w['name_fr'], 'adresse' => 'Centre ville, ' . $w['name_fr'], 'map' => null];
            }
            return $ok([
                'my_desk' => ['hub_id' => 16, 'hub_name' => 'Station Alger Centre',
                    'location' => ['wilaya' => 'Alger', 'commune' => 'Alger Centre', 'adresse' => '05 Rue Didouche Mourad',
                        'phone' => '0550 00 00 00', 'phone2' => null, 'email' => 'alger@exemple.dz',
                        'map' => 'https://maps.google.com/?q=Alger+Centre'],
                    'working_hours' => [['days' => 'Dimanche - Jeudi', 'hours' => '09:00 - 17:00']]],
                'other_desks' => $others,
            ]);

        case '/api/v1/get/communes':
            $wid = (int) ($q['wilaya_id'] ?? 0);
            $communes = geo_communes();
            $obj = [];
            $i = 0;
            foreach ($communes as $wid2 => $names) {
                if ($wid && (int) $wid2 !== $wid) continue;
                foreach ($names as $nom) {
                    $obj[(string) $i] = ['nom' => $nom, 'wilaya_id' => (int) $wid2,
                        'code_postal' => (string) (1000 + ((int) $wid2 * 10) + $i), 'has_stop_desk' => ($i % 6 === 0) ? 1 : 0];
                    $i++;
                }
            }
            return $ok($obj);

        case '/api/v1/get/fees':
            return $ok(geo_mock_fees());

        case '/api/v1/get/products/list':
            $products = [];
            for ($i = 0; $i < 8; $i++) {
                $products[] = ['reference' => 'SKU-00' . ($i + 1), 'barcode' => '61300000000' . $i,
                    'title' => 'منتج تجريبي ' . ($i + 1), 'is_active' => 1, 'image' => '',
                    'stock_disponible' => 20 - $i, 'stock_reserve' => $i, 'stock_phisique' => 20];
            }
            return $ok(['products' => $products, 'pagination' => ['current_page' => (int) ($q['page'] ?? 1), 'per_page' => 15, 'total' => 8, 'last_page' => 1]]);

        default:
            return $ok(['success' => true, 'message' => "وضع تجريبي: $method $path"]);
    }
}

/** ملف PDF بسيط صالح (ملصق تجريبي) */
function eco_mock_pdf($tracking) {
    $lines = ["SITYCOM - ETIQUETTE DEMO", "Tracking: $tracking", "Destinataire: Client demo", "Wilaya: Alger", "Montant: 0 DA"];
    $parts = [];
    foreach ($lines as $l) $parts[] = '(' . str_replace(['\\', '(', ')'], ['\\\\', '\\(', '\\)'], $l) . ') Tj T*';
    $content = "BT /F1 14 Tf 60 760 Td\n" . implode("\n", $parts) . "\nET";
    $objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        '<< /Length ' . strlen($content) . " >>\nstream\n" . $content . "\nendstream",
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    $pdf = "%PDF-1.4\n";
    $offsets = [];
    foreach ($objs as $i => $o) {
        $offsets[] = strlen($pdf);
        $pdf .= ($i + 1) . " 0 obj\n$o\nendobj\n";
    }
    $xref = strlen($pdf);
    $pdf .= "xref\n0 " . (count($objs) + 1) . "\n0000000000 65535 f \n";
    foreach ($offsets as $off) $pdf .= str_pad((string) $off, 10, '0', STR_PAD_LEFT) . " 00000 n \n";
    $pdf .= "trailer\n<< /Size " . (count($objs) + 1) . " /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n";
    return $pdf;
}
