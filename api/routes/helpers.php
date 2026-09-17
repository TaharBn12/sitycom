<?php
/**
 * أدوات مشتركة للمسارات
 */

function current_user() {
    $token = bearer_token();
    if (!$token) return null;
    $row = q_one(
        "SELECT u.id, u.username, u.name, u.role, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND u.active = 1",
        [$token]
    );
    if (!$row) return null;
    if (strcmp($row['expires_at'], now()) < 0) {
        q_exec("DELETE FROM sessions WHERE token = ?", [$token]);
        return null;
    }
    return $row;
}

function require_auth() {
    $u = current_user();
    if (!$u) throw new HttpError(401, 'انتهت الجلسة — سجّل الدخول من جديد', 'UNAUTHORIZED');
    return $u;
}

function load_order($id) {
    $id = (int) $id;
    $order = q_one("SELECT * FROM orders WHERE id = ?", [$id]);
    if (!$order) return null;
    $order['items'] = q_all("SELECT * FROM order_items WHERE order_id = ?", [$id]);
    $order['shipment'] = q_one("SELECT * FROM shipments WHERE order_id = ?", [$id]) ?: null;
    $order['events'] = q_all("SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT 100", [$id]);
    return $order;
}

function ensure_shipment($orderId) {
    $exists = q_one("SELECT id FROM shipments WHERE order_id = ?", [$orderId]);
    if ($exists) return (int) $exists['id'];
    $r = q_exec("INSERT INTO shipments (order_id, type, stop_desk, produit, quantite) VALUES (?, 1, 0, '', '')", [$orderId]);
    return $r['id'];
}

function save_shipment($orderId, $patch) {
    if (!$patch) return;
    ensure_shipment($orderId);
    $sets = [];
    $vals = [];
    foreach ($patch as $k => $v) {
        $sets[] = "`$k` = ?";
        $vals[] = is_bool($v) ? ($v ? 1 : 0) : $v;
    }
    $vals[] = $orderId;
    q_exec("UPDATE shipments SET " . implode(', ', $sets) . " WHERE order_id = ?", $vals);
}

function record_event($orderId, $tracking, $status, $activity, $extra = []) {
    q_exec(
        "INSERT INTO order_events (order_id, tracking, status, activity, station, driver, details, event_date, event_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [$orderId, (string) $tracking, (string) $status, (string) $activity,
         $extra['station'] ?? '', $extra['driver'] ?? '', $extra['details'] ?? '',
         $extra['date'] ?? '', $extra['time'] ?? '', now()]
    );
}

/** معاملات create/order */
function build_create_params($order, $override = []) {
    $s = $order['shipment'] ?: [];
    $items = $order['items'] ?: [];
    $names = [];
    foreach ($items as $it) $names[] = $it['name'] . ' x' . $it['qty'];
    $p = [
        'reference' => $override['reference'] ?? ($s['reference'] ?? $order['order_number']),
        'nom_client' => $override['nom_client'] ?? $order['customer_name'],
        'telephone' => $override['telephone'] ?? $order['phone'],
        'telephone_2' => $override['telephone_2'] ?? ($order['phone2'] ?: null),
        'adresse' => $override['adresse'] ?? $order['address'],
        'code_postal' => $override['code_postal'] ?? (!empty($order['stop_desk']) ? ($order['desk_code'] ?: null) : null),
        'commune' => $override['commune'] ?? $order['commune'],
        'code_wilaya' => $override['code_wilaya'] ?? $order['wilaya_id'],
        'montant' => $override['montant'] ?? $order['total'],
        'remarque' => $override['remarque'] ?? ($s['remarque'] ?? ($order['notes'] ?: null)),
        'produit' => $override['produit'] ?? ($s['produit'] ?? (implode(' / ', $names) ?: null)),
        'stock' => (int) ($override['stock'] ?? ($s['stock'] ?? 0)),
        'boutique' => $override['boutique'] ?? ($s['boutique'] ?: null),
        'type' => (int) ($override['type'] ?? ($s['type'] ?? 1)),
        'stop_desk' => (int) ($override['stop_desk'] ?? ($order['stop_desk'] ?? 0)),
        'weight' => $override['weight'] ?? ($s['weight'] ?: null),
        'fragile' => (int) ($override['fragile'] ?? ($s['fragile'] ?? 0)),
        'gps_link' => $override['gps_link'] ?? ($s['gps_link'] ?: null),
        'produit_a_recuperer' => $override['produit_a_recuperer'] ?? ($s['produit_a_recuperer'] ?: null),
    ];
    if (!empty($p['stock'])) {
        $q = [];
        foreach ($items as $it) $q[] = $it['qty'];
        $p['quantite'] = $override['quantite'] ?? ($s['quantite'] ?: (implode(',', $q) ?: '1'));
    }
    $clean = [];
    foreach ($p as $k => $v) {
        if ($v === null || $v === '') continue;
        $clean[$k] = $v;
    }
    return $clean;
}

/** معاملات update/order (أسماء حقول مختلفة!) */
function build_update_params($order, $override = []) {
    $s = $order['shipment'] ?: [];
    $names = [];
    foreach (($order['items'] ?: []) as $it) $names[] = $it['name'];
    $p = [
        'tracking' => $override['tracking'] ?? ($s['tracking'] ?? ''),
        'reference' => $override['reference'] ?? ($s['reference'] ?? $order['order_number']),
        'client' => $override['client'] ?? $order['customer_name'],
        'tel' => $override['tel'] ?? $order['phone'],
        'tel2' => $override['tel2'] ?? ($order['phone2'] ?: null),
        'adresse' => $override['adresse'] ?? $order['address'],
        'code_postal' => $override['code_postal'] ?? (!empty($order['stop_desk']) ? ($order['desk_code'] ?: null) : null),
        'commune' => $override['commune'] ?? $order['commune'],
        'wilaya' => $override['wilaya'] ?? $order['wilaya_id'],
        'montant' => $override['montant'] ?? $order['total'],
        'remarque' => $override['remarque'] ?? ($order['notes'] ?: null),
        'product' => $override['product'] ?? ($s['produit'] ?: (implode(', ', $names) ?: null)),
        'boutique' => $override['boutique'] ?? ($s['boutique'] ?: null),
        'type' => (int) ($override['type'] ?? ($s['type'] ?? 1)),
        'stop_desk' => (int) ($override['stop_desk'] ?? ($order['stop_desk'] ?? 0)),
        'fragile' => (int) ($override['fragile'] ?? ($s['fragile'] ?? 0)),
        'gps_link' => $override['gps_link'] ?? ($s['gps_link'] ?: null),
    ];
    $clean = [];
    foreach ($p as $k => $v) {
        if ($v === null || $v === '') continue;
        $clean[$k] = $v;
    }
    return $clean;
}

function map_activity_to_status($activity) {
    $map = [
        'order_information_received_by_carrier' => 'prete_a_expedier',
        'notification_on_order' => 'en_preparation',
        'picked' => 'en_ramassage',
        'accepted_by_carrier' => 'en_hub',
        'dispatched_to_driver' => 'en_livraison',
        'attempt_delivery' => 'en_livraison',
        'return_asked' => 'retour_chez_livreur',
        'return_in_transit' => 'retour_transit_entrepot',
        'Return_received' => 'retour_recu',
        'livred' => 'livre_non_encaisse',
        'encaissed' => 'encaisse_non_paye',
        'payed' => 'paye_et_archive',
    ];
    return $map[$activity] ?? $activity;
}

function is_activity_key($s) {
    return in_array((string) $s, eco_activities(), true);
}

/** إرسال طلبية إلى Ecotrack */
function push_order_to_ecotrack($order, $user, $validateAfter = false) {
    $params = build_create_params($order);
    $res = eco_create_order($params);
    $tracking = $res['data']['tracking'] ?? null;
    if (!$tracking) throw new EcotrackError('لم يُرجع Ecotrack رقم تتبع', 'NO_TRACKING');
    save_shipment($order['id'], [
        'tracking' => $tracking,
        'ecotrack_status' => 'prete_a_expedier',
        'pushed_at' => now(),
        'raw' => json_encode($res['data'], JSON_UNESCAPED_UNICODE),
        'produit' => $params['produit'] ?? '',
        'quantite' => $params['quantite'] ?? '',
    ]);
    q_exec("UPDATE orders SET status = 'prete_a_expedier', updated_at = ? WHERE id = ?", [now(), $order['id']]);
    record_event($order['id'], $tracking, 'prete_a_expedier', 'order_information_received_by_carrier', ['details' => 'تم إرسال الطلبية إلى Ecotrack']);
    log_activity($user['id'] ?? null, $user['username'] ?? '', 'ecotrack.create', 'order', $order['id'], $tracking, 1);

    $validated = false;
    if ($validateAfter) {
        $eco = setting('ecotrack', []);
        $ask = !empty($eco['ask_collection']) ? 1 : 0;
        eco_valid_order($tracking, $ask);
        save_shipment($order['id'], ['validated_at' => now(), 'ask_collection' => $ask]);
        log_activity($user['id'] ?? null, $user['username'] ?? '', 'ecotrack.valid', 'order', $order['id'], $tracking, 1);
        $validated = true;
    }
    return ['ok' => true, 'tracking' => $tracking, 'validated' => $validated, 'params' => $params];
}

function mask_settings_token($settings) {
    if (isset($settings['ecotrack']) && is_array($settings['ecotrack'])) {
        $settings['ecotrack']['api_token'] = mask_token($settings['ecotrack']['api_token'] ?? '');
        $settings['ecotrack']['_has_token'] = !empty(eco_config()['token']);
    }
    return $settings;
}
