<?php
/**
 * أدوات مشتركة: استجابات JSON، الإدخال، المصادقة، التنسيق
 */

class HttpError extends Exception {
    public $status;
    public $errCode;
    public $details;
    public function __construct($status, $message, $code = null, $details = null) {
        parent::__construct($message);
        $this->status  = $status;
        $this->errCode = $code;
        $this->details = $details;
    }
}

function json_out($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_ok($extra = []) {
    json_out(array_merge(['ok' => true], $extra));
}

function fail($message, $status = 400, $code = null, $details = null) {
    json_out(['ok' => false, 'error' => $message, 'code' => $code, 'details' => $details], $status);
}

/** جسم الطلب مفكوكاً JSON */
function body($key = null, $default = null) {
    static $data = null;
    if ($data === null) {
        $raw = file_get_contents('php://input');
        $data = json_decode($raw ?: '', true);
        if (!is_array($data)) $data = [];
    }
    if ($key === null) return $data;
    return array_key_exists($key, $data) ? $data[$key] : $default;
}

function param($key, $default = null) {
    return isset($_GET[$key]) && $_GET[$key] !== '' ? $_GET[$key] : $default;
}
function bparam($key, $default = null) {
    $v = body($key, null);
    return $v === null ? $default : $v;
}

function num($v, $default = 0) {
    if ($v === null || $v === '') return $default;
    return is_numeric($v) ? ($v + 0) : $default;
}
function intval0($v, $default = 0) {
    return (int) num($v, $default);
}
function bool01($v) {
    return ($v === true || $v === 1 || $v === '1' || $v === 'true' || $v === 'on') ? 1 : 0;
}
function has($arr, $key) {
    return is_array($arr) && array_key_exists($key, $arr) && $arr[$key] !== null;
}

function now() {
    return date('Y-m-d H:i:s');
}
function today() {
    return date('Y-m-d');
}
function uid($prefix = '') {
    return $prefix . bin2hex(random_bytes(8));
}
function order_number() {
    return 'CMD-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(2)));
}

function pagination($defaultLimit = 50, $maxLimit = 500) {
    $page  = max(1, intval0($_GET['page'] ?? 1, 1));
    $limit = min($maxLimit, max(1, intval0($_GET['limit'] ?? $defaultLimit, $defaultLimit)));
    return [$page, $limit, ($page - 1) * $limit];
}

function date_ago_days($days) {
    return date('Y-m-d H:i:s', time() - ($days * 86400));
}

/** ترويسة Authorization (مع دعم الاستضافة المشتركة التي تحذفها) */
function bearer_token() {
    $h = '';
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $k => $v) {
            if (strtolower($k) === 'authorization') { $h = $v; break; }
        }
    }
    if (!$h && !empty($_SERVER['HTTP_AUTHORIZATION'])) $h = $_SERVER['HTTP_AUTHORIZATION'];
    if (!$h && !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $h = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    if (!$h && !empty($_SERVER['X-SESSION-TOKEN'])) $h = 'Bearer ' . $_SERVER['X-SESSION-TOKEN'];
    if (!$h && !empty($_GET['token'])) $h = 'Bearer ' . $_GET['token'];
    if ($h && stripos($h, 'bearer ') === 0) return trim(substr($h, 7));
    return $h ?: null;
}

function mask_token($token) {
    $t = (string) $token;
    if ($t === '') return '';
    if (strlen($t) <= 12) return substr($t, 0, 3) . '••••';
    return substr($t, 0, 6) . '••••••••' . substr($t, -6);
}

function slugify($text) {
    $text = (string) $text;
    $ascii = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text);
    if ($ascii === false || $ascii === '') $ascii = '';
    $slug = strtolower(trim(preg_replace('~[^a-zA-Z0-9]+~', '-', $ascii), '-'));
    if ($slug === '') $slug = substr(md5($text . mt_rand()), 0, 10);
    return $slug;
}
