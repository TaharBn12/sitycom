<?php
/**
 * المنتجات والتصنيفات
 */

function rt_catalog($method, $seg, $body) {
    $u = require_auth();
    $n1 = $seg[1] ?? '';
    $n2 = $seg[2] ?? '';
    $n3 = $seg[3] ?? '';

    /* ── التصنيفات ─────────────────────────────────────── */
    if ($n1 === 'categories') {
        if ($method === 'GET') {
            json_ok(['categories' => q_all("SELECT * FROM categories ORDER BY id")]);
        }
        if ($method === 'POST') {
            if (empty($body['name_ar'])) throw new HttpError(400, 'اسم التصنيف بالعربية مطلوب');
            $r = q_exec("INSERT INTO categories (name_ar, name_fr, name_en, slug, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                [$body['name_ar'], $body['name_fr'] ?? '', $body['name_en'] ?? '', slugify($body['name_ar']), now()]);
            log_activity($u['id'], $u['username'], 'category.create', 'category', $r['id'], $body['name_ar'], 1);
            json_ok(['id' => $r['id']]);
        }
        $id = (int) $n2;
        if ($id > 0 && $method === 'PUT') {
            q_exec("UPDATE categories SET name_ar = ?, name_fr = ?, name_en = ?, active = ? WHERE id = ?",
                [$body['name_ar'] ?? '', $body['name_fr'] ?? '', $body['name_en'] ?? '', bool01($body['active'] ?? 1), $id]);
            log_activity($u['id'], $u['username'], 'category.update', 'category', $id, '', 1);
            json_ok();
        }
        if ($id > 0 && $method === 'DELETE') {
            q_exec("UPDATE products SET category_id = NULL WHERE category_id = ?", [$id]);
            q_exec("DELETE FROM categories WHERE id = ?", [$id]);
            log_activity($u['id'], $u['username'], 'category.delete', 'category', $id, '', 1);
            json_ok();
        }
    }

    /* ── المنتجات ──────────────────────────────────────── */
    if ($n1 === 'products') {
        if ($n2 === 'import-ecotrack' && $method === 'POST') return import_ecotrack_products($u, $body);

        if ($n2 === '' && $method === 'GET') return list_products();
        if ($n2 === '' && $method === 'POST') return save_product($u, null, $body);

        $id = (int) $n2;
        if ($id <= 0) throw new HttpError(404, 'المنتج غير موجود', 'NOT_FOUND');

        if ($n3 === 'stock' && $method === 'PATCH') {
            if (array_key_exists('stock', $body)) {
                q_exec("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", [max(0, intval0($body['stock'])), now(), $id]);
            } elseif (array_key_exists('delta', $body)) {
                q_exec("UPDATE products SET stock = MAX(0, stock + ?), updated_at = ? WHERE id = ?",
                    [intval0($body['delta']), now(), $id]);
            } else {
                throw new HttpError(400, 'أرسل stock أو delta');
            }
            $p = q_one("SELECT id, stock, name_ar FROM products WHERE id = ?", [$id]);
            log_activity($u['id'], $u['username'], 'product.stock', 'product', $id, (string) ($p['stock'] ?? ''), 1);
            json_ok(['product' => $p]);
        }
        if ($method === 'GET') {
            $p = q_one("SELECT p.*, c.name_ar AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?", [$id]);
            if (!$p) throw new HttpError(404, 'المنتج غير موجود');
            json_ok(['product' => $p]);
        }
        if ($method === 'PUT') return save_product($u, $id, $body);
        if ($method === 'DELETE') {
            q_exec("DELETE FROM order_items WHERE product_id = ?", [$id]);
            q_exec("DELETE FROM products WHERE id = ?", [$id]);
            log_activity($u['id'], $u['username'], 'product.delete', 'product', $id, '', 1);
            json_ok();
        }
    }

    throw new HttpError(404, 'المسار غير موجود', 'NOT_FOUND');
}

function list_products() {
    list($page, $limit, $offset) = pagination(24, 500);
    $where = [];
    $params = [];
    if (param('q')) {
        $like = '%' . mb_strtolower((string) param('q')) . '%';
        $where[] = "(LOWER(p.name_ar) LIKE ? OR LOWER(p.name_fr) LIKE ? OR LOWER(p.name_en) LIKE ? OR LOWER(p.sku) LIKE ?)";
        array_push($params, $like, $like, $like, $like);
    }
    if (param('category_id')) { $where[] = 'p.category_id = ?'; $params[] = intval0($_GET['category_id']); }
    $status = param('status');
    if ($status === 'low') $where[] = 'p.stock <= 5';
    if ($status === 'out') $where[] = 'p.stock <= 0';
    if ($status === 'active') $where[] = 'p.active = 1';
    if ($status === 'inactive') $where[] = 'p.active = 0';

    $w = $where ? ('WHERE ' . implode(' AND ', $where)) : '';
    $rows = q_all("SELECT p.*, c.name_ar AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
                   $w ORDER BY p.id DESC LIMIT $limit OFFSET $offset", $params);
    $total = (int) q_val("SELECT COUNT(*) AS c FROM products p LEFT JOIN categories c ON c.id = p.category_id $w", $params, 0);
    json_ok(['products' => $rows, 'total' => $total, 'page' => $page, 'limit' => $limit,
             'pages' => max(1, (int) ceil($total / $limit))]);
}

function save_product($u, $id, $b) {
    if (empty($b['name_ar'])) throw new HttpError(400, 'اسم المنتج مطلوب');
    $data = [
        'sku' => $b['sku'] ?? ($id ? null : ('SKU-' . substr((string) time(), -6))),
        'name_ar' => $b['name_ar'],
        'name_fr' => $b['name_fr'] ?? '',
        'name_en' => $b['name_en'] ?? '',
        'description' => $b['description'] ?? '',
        'price' => num($b['price'] ?? 0),
        'cost' => num($b['cost'] ?? 0),
        'stock' => intval0($b['stock'] ?? 0),
        'category_id' => !empty($b['category_id']) ? intval0($b['category_id']) : null,
        'image_url' => $b['image_url'] ?? '',
        'weight' => num($b['weight'] ?? 0),
        'fragile' => bool01($b['fragile'] ?? 0),
        'ecotrack_reference' => $b['ecotrack_reference'] ?? ($b['sku'] ?? ''),
        'active' => bool01($b['active'] ?? 1),
        'updated_at' => now(),
    ];
    if ($id) {
        $data = array_filter($data, function ($v, $k) { return !($k === 'sku' && $v === null); }, ARRAY_FILTER_USE_BOTH);
        $sets = [];
        $vals = [];
        foreach ($data as $k => $v) { $sets[] = "`$k` = ?"; $vals[] = $v; }
        $vals[] = $id;
        q_exec("UPDATE products SET " . implode(', ', $sets) . " WHERE id = ?", $vals);
        log_activity($u['id'], $u['username'], 'product.update', 'product', $id, $b['name_ar'], 1);
        json_ok(['id' => $id]);
    }
    $data['created_at'] = now();
    $cols = array_keys($data);
    $ph = implode(',', array_fill(0, count($cols), '?'));
    $r = q_exec("INSERT INTO products (`" . implode('`,`', $cols) . "`) VALUES ($ph)", array_values($data));
    log_activity($u['id'], $u['username'], 'product.create', 'product', $r['id'], $b['name_ar'], 1);
    json_ok(['id' => $r['id']]);
}

function import_ecotrack_products($u, $b) {
    $items = isset($b['items']) && is_array($b['items']) ? $b['items'] : [];
    if (!$items) throw new HttpError(400, 'لا توجد منتجات للاستيراد');
    $created = 0;
    $updated = 0;
    foreach ($items as $it) {
        $ref = trim((string) ($it['reference'] ?? ''));
        if ($ref === '') continue;
        $exists = q_one("SELECT id FROM products WHERE ecotrack_reference = ? OR sku = ?", [$ref, $ref]);
        if ($exists) {
            q_exec("UPDATE products SET stock = ?, updated_at = ? WHERE id = ?", [intval0($it['stock_disponible'] ?? 0), now(), $exists['id']]);
            $updated++;
        } else {
            $title = $it['title'] ?? $ref;
            q_exec("INSERT INTO products (sku, name_ar, name_fr, name_en, description, price, cost, stock, category_id,
                        image_url, weight, fragile, ecotrack_reference, active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, '', 0, 0, ?, NULL, ?, 0, 0, ?, 1, ?, ?)",
                [$ref, $title, $title, $title, intval0($it['stock_disponible'] ?? 0), $it['image'] ?? '', $ref, now(), now()]);
            $created++;
        }
    }
    log_activity($u['id'], $u['username'], 'product.import', 'product', '', "$created جديد / $updated محدّث", 1);
    json_ok(['created' => $created, 'updated' => $updated]);
}
