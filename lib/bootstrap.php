<?php
declare(strict_types=1);

const APP_VERSION = '1.0.0';
define('ROOT', dirname(__DIR__));
define('DATA', ROOT . '/data');

error_reporting(E_ALL);
ini_set('display_errors', '0');

if (!is_dir(DATA)) @mkdir(DATA, 0775, true);
if (!is_dir(DATA . '/sessions')) @mkdir(DATA . '/sessions', 0775, true);
if (!is_dir(DATA . '/uploads')) @mkdir(DATA . '/uploads', 0775, true);

/* ---------- session ---------- */
class DbSessions implements SessionHandlerInterface {
    public function open(string $path, string $name): bool { db()->exec('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, data TEXT NOT NULL, ts INTEGER NOT NULL)'); return true; }
    public function close(): bool { return true; }
    public function read(string $id): string|false { $r = db()->prepare('SELECT data FROM sessions WHERE id=?'); $r->execute([$id]); $v = $r->fetchColumn(); return $v === false ? '' : (string)$v; }
    public function write(string $id, string $data): bool { db()->prepare('INSERT OR REPLACE INTO sessions(id,data,ts) VALUES(?,?,?)')->execute([$id, $data, time()]); return true; }
    public function destroy(string $id): bool { db()->prepare('DELETE FROM sessions WHERE id=?')->execute([$id]); return true; }
    public function gc(int $max): int|false { return db()->exec('DELETE FROM sessions WHERE ts < ' . (time() - 60 * 86400)); }
}
function start_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_set_save_handler(new DbSessions(), true);   // sessions live in app.db: no dependence on PHP session folder permissions
    ini_set('session.gc_maxlifetime', (string)(60 * 86400));
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $https,
    ]);
    session_name('webrxpad');
    session_start();
}

/* ---------- output helpers ---------- */
function out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }

set_exception_handler(function (Throwable $e) {
    error_log('[webrxpad] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    fail('Server error: ' . $e->getMessage(), 500);
});

/* ---------- database ---------- */
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . DATA . '/app.db');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA synchronous=NORMAL');
    $pdo->exec('PRAGMA busy_timeout=8000');
    $pdo->exec('PRAGMA foreign_keys=ON');
    schema($pdo);
    return $pdo;
}

function schema(PDO $p): void {
    $p->exec("CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL DEFAULT '',
        pass_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'doctor',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER, last_login INTEGER)");
    $p->exec("CREATE TABLE IF NOT EXISTS settings(
        user_id INTEGER NOT NULL, k TEXT NOT NULL, v TEXT, PRIMARY KEY(user_id, k))");
    $p->exec("CREATE TABLE IF NOT EXISTS chambers(
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT DEFAULT '', address TEXT DEFAULT '',
        phone TEXT DEFAULT '', lat TEXT DEFAULT '', lon TEXT DEFAULT '', note TEXT DEFAULT '', pos INTEGER DEFAULT 0)");
    $p->exec("CREATE INDEX IF NOT EXISTS idx_ch_user ON chambers(user_id)");
    $p->exec("CREATE TABLE IF NOT EXISTS patients(
        id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, age TEXT DEFAULT '', sex TEXT DEFAULT '',
        phone TEXT DEFAULT '', address TEXT DEFAULT '', blood_group TEXT DEFAULT '', weight TEXT DEFAULT '',
        notes TEXT DEFAULT '', created_at INTEGER)");
    $p->exec("CREATE INDEX IF NOT EXISTS idx_pat_user ON patients(user_id, name)");
    $p->exec("CREATE TABLE IF NOT EXISTS prescriptions(
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, patient_id TEXT NOT NULL,
        rx_date TEXT DEFAULT '', age TEXT DEFAULT '', data TEXT DEFAULT '{}', created_at INTEGER, updated_at INTEGER)");
    $p->exec("CREATE INDEX IF NOT EXISTS idx_rx_pat ON prescriptions(patient_id, rx_date)");
    $p->exec("CREATE INDEX IF NOT EXISTS idx_rx_user ON prescriptions(user_id)");
    $p->exec("CREATE TABLE IF NOT EXISTS list_items(
        id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, list_type TEXT NOT NULL,
        name TEXT NOT NULL, plain TEXT NOT NULL, UNIQUE(owner_id, list_type, name))");
    $p->exec("CREATE INDEX IF NOT EXISTS idx_li_plain ON list_items(list_type, plain)");
    $p->exec("CREATE INDEX IF NOT EXISTS idx_li_owner ON list_items(owner_id, list_type)");
}

function q(string $sql, array $args = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}
function row(string $sql, array $args = []): ?array { $r = q($sql, $args)->fetch(); return $r ?: null; }
function rows(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }
function val(string $sql, array $args = []) { $r = q($sql, $args)->fetch(PDO::FETCH_NUM); return $r ? $r[0] : null; }
function now_ms(): int { return (int)round(microtime(true) * 1000); }

/* ---------- settings (user_id 0 = global) ---------- */
function setting(int $uid, string $k, string $def = ''): string {
    $v = val('SELECT v FROM settings WHERE user_id=? AND k=?', [$uid, $k]);
    return $v === null ? $def : (string)$v;
}
function set_setting(int $uid, string $k, string $v): void {
    q('INSERT INTO settings(user_id,k,v) VALUES(?,?,?) ON CONFLICT(user_id,k) DO UPDATE SET v=excluded.v', [$uid, $k, $v]);
}

/* ---------- request ---------- */
function body(): array {
    static $b = null;
    if ($b !== null) return $b;
    $raw = file_get_contents('php://input');
    $j = $raw !== '' ? json_decode($raw, true) : null;
    $b = is_array($j) ? $j : [];
    return $b;
}
function s(array $a, string $k, string $def = ''): string {
    $v = $a[$k] ?? $def;
    return is_scalar($v) ? (string)$v : $def;
}

/* ---------- auth ---------- */
function csrf_token(): string {
    start_session();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(20));
    return $_SESSION['csrf'];
}
function check_csrf(): void {
    start_session();
    $h = $_SERVER['HTTP_X_CSRF'] ?? '';
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $h)) fail('Session expired. Please reload the page.', 403);
}
function me(): ?array {
    start_session();
    $id = (int)($_SESSION['uid'] ?? 0);
    if (!$id) return null;
    $u = row('SELECT id,email,name,role,status FROM users WHERE id=?', [$id]);
    if (!$u || $u['status'] !== 'approved') { unset($_SESSION['uid']); return null; }
    return $u;
}
function need_login(): array { $u = me(); if (!$u) fail('Please sign in', 401); return $u; }
function need_admin(): array { $u = need_login(); if ($u['role'] !== 'admin') fail('Admin only', 403); return $u; }
function has_admin(): bool { return (int)val("SELECT COUNT(*) FROM users WHERE role='admin'") > 0; }

function valid_email(string $e): bool { return (bool)filter_var($e, FILTER_VALIDATE_EMAIL); }

/* ---------- rich text helpers (same rules as the Android app) ---------- */
function plain_text(string $html): string {
    $t = preg_replace('~<br\s*/?>~i', "\n", str_replace(["\r\n", "\r"], "\n", $html));
    $t = html_entity_decode(strip_tags($t), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    return trim($t);
}
/** Findings list entry: "Name | unit=mmHg" or "Name | options=A;B;C | multi" (same text format as the Android app). */
/** Allowed upload kinds: photo, watermark and extra page pictures img_<id>. */
function image_kind_ok(string $k): bool { return $k === 'photo' || $k === 'watermark' || (bool)preg_match('/^img_[a-z0-9]{6,16}$/', $k); }
function finding_parse(string $raw): array {
    $parts = array_map('trim', explode('|', $raw));
    $name = array_shift($parts) ?? '';
    $unit = ''; $opts = []; $multi = false;
    foreach ($parts as $p) {
        if (stripos($p, 'unit=') === 0) $unit = trim(substr($p, 5));
        elseif (stripos($p, 'options=') === 0) $opts = array_values(array_filter(array_map('trim', explode(';', substr($p, 8))), fn($x) => $x !== ''));
        elseif (strcasecmp($p, 'multi') === 0) $multi = true;
    }
    return ['name' => $name, 'unit' => $unit, 'options' => $opts, 'multi' => $multi && count($opts) > 0];
}
function finding_encode(array $d): string {
    $cl = fn($x) => trim(str_replace(["|", "\n"], ['/', ' '], (string)$x));
    $o = $cl($d['name'] ?? '');
    if (trim((string)($d['unit'] ?? '')) !== '') $o .= ' | unit=' . $cl($d['unit']);
    $opts = array_values(array_filter(array_map(fn($x) => str_replace(';', ',', $cl($x)), $d['options'] ?? []), fn($x) => $x !== ''));
    if ($opts) { $o .= ' | options=' . implode(';', $opts); if (!empty($d['multi'])) $o .= ' | multi'; }
    return $o;
}
function advice_decode(string $raw): array {
    $t = trim($raw);
    if ($t !== '' && $t[0] === '{') {
        $o = json_decode($t, true);
        if (is_array($o) && (isset($o['c']) || isset($o['b']))) {
            return ['c' => (string)($o['c'] ?? ''), 'b' => (string)($o['b'] ?? ''), 's' => !empty($o['s'])];
        }
    }
    $first = '';
    foreach (preg_split('~\R~u', $t) as $ln) { if (trim($ln) !== '') { $first = $ln; break; } }
    return ['c' => mb_substr(plain_text($first), 0, 80), 'b' => $t, 's' => false];
}
function advice_bullets(array $a): array {
    $out = [];
    foreach (preg_split('~\R~u', str_replace("\r", '', $a['b'])) as $line) {
        if (trim($line) === '') continue;
        $x = str_replace("\t", '    ', $line);
        $lead = strlen($x) - strlen(ltrim($x));
        $t = trim($x);
        if (mb_strlen($t) > 1 && mb_strpos('•-*–·', mb_substr($t, 0, 1)) !== false && mb_substr($t, 1, 1) === ' ') $t = trim(mb_substr($t, 2));
        $out[] = [min(intdiv($lead, 2), 4), $t];
    }
    return $out;
}
function advice_encode(array $a): string {
    return json_encode(['c' => $a['c'], 'b' => $a['b'], 's' => (bool)$a['s']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
function advice_normalize(string $raw): string {
    $a = advice_decode($raw);
    $cap = $a['c'] !== '' ? $a['c'] : '';
    if (trim($cap) === '') { $b = advice_bullets($a); $cap = $b ? mb_substr(plain_text($b[0][1]), 0, 80) : ''; }
    $a['c'] = $cap; $a['s'] = false;
    return advice_encode($a);
}
function advice_parse_blocks(string $text): array {
    $out = []; $cap = null; $body = [];
    $flush = function () use (&$out, &$cap, &$body) {
        $b = rtrim(implode("\n", $body));
        if ($cap !== null || trim($b) !== '') $out[] = ['c' => $cap ?? '', 'b' => $b, 's' => false];
        $cap = null; $body = [];
    };
    $text = preg_replace('/^\xEF\xBB\xBF/', '', str_replace("\r", '', $text));
    foreach (explode("\n", $text) as $raw) {
        if (str_starts_with(ltrim($raw), '##')) { $flush(); $cap = trim(substr(trim($raw), 2)); }
        else $body[] = $raw;
    }
    $flush();
    return array_values(array_filter($out, fn($x) => trim($x['c']) !== '' || trim($x['b']) !== ''));
}
function advice_block_text(array $items): string {
    $parts = [];
    foreach ($items as $a) $parts[] = rtrim('## ' . $a['c'] . "\n" . $a['b']);
    return implode("\n\n", $parts) . "\n";
}

const LIST_TYPES = ['complaints', 'history', 'findings', 'investigation', 'diagnosis', 'advice', 'follow_up', 'instruction'];

function new_patient_id(): string {
    $alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $id = '';
        for ($i = 0; $i < 10; $i++) $id .= $alpha[random_int(0, strlen($alpha) - 1)];
    } while (val('SELECT 1 FROM patients WHERE id=?', [$id]));
    return $id;
}
