<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/lists.php';
require __DIR__ . '/lib/drug.php';
require __DIR__ . '/lib/smtp.php';

start_session();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

/* ===== public / auth ===== */
if ($action === 'diag') {
    out(['php' => PHP_VERSION, 'session_id' => session_id(), 'cookie_received' => isset($_COOKIE['webrxpad']), 'cookie_header' => $_SERVER['HTTP_COOKIE'] ?? '', 'data_writable' => is_writable(DATA), 'https' => $_SERVER['HTTPS'] ?? '', 'host' => $_SERVER['HTTP_HOST'] ?? '', 'uri' => $_SERVER['REQUEST_URI'] ?? '']);
}
if ($action === 'boot') {
    $u = me();
    out(['csrf' => csrf_token(), 'setup_needed' => !has_admin(), 'user' => $u, 'version' => APP_VERSION]);
}

/* ===== file downloads (GET) ===== */
if ($action === 'file') {
    $u = need_login();
    $kind = $_GET['kind'] ?? '';
    if (!image_kind_ok($kind)) fail('Bad request');
    $dir = DATA . '/uploads/' . $u['id'];
    foreach (['jpg', 'png', 'webp'] as $ext) {
        $f = "$dir/$kind.$ext";
        if (is_file($f)) {
            header('Content-Type: ' . ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'][$ext]);
            header('Cache-Control: private, max-age=3600');
            readfile($f);
            exit;
        }
    }
    http_response_code(404);
    exit;
}
if ($action === 'engine_export') {
    need_admin();
    $e = $_GET['engine'] ?? '';
    if (!in_array($e, ENGINES, true) || !drug_exists($e)) fail('Not found', 404);
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="drug_' . $e . '.db"');
    header('Content-Length: ' . filesize(drug_file($e)));
    readfile(drug_file($e));
    exit;
}

if ($method !== 'POST') fail('POST required', 405);
if (!in_array($action, ['boot'], true)) check_csrf();
$B = body();

function user_rows_summary(): array {
    return rows("SELECT u.id,u.email,u.name,u.role,u.status,u.created_at,u.last_login,
        (SELECT COUNT(*) FROM patients p WHERE p.user_id=u.id) AS patients,
        (SELECT COUNT(*) FROM prescriptions r WHERE r.user_id=u.id) AS prescriptions,
        (SELECT COUNT(*) FROM list_items l WHERE l.owner_id=u.id) AS list_items
        FROM users u ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at DESC");
}
function pat_json(array $p): array {
    return ['id' => $p['id'], 'name' => $p['name'], 'age' => $p['age'], 'sex' => $p['sex'], 'phone' => $p['phone'], 'address' => $p['address'],
        'blood_group' => $p['blood_group'], 'weight' => $p['weight'], 'notes' => $p['notes'], 'created_at' => (int)$p['created_at']];
}
function rx_json(array $r): array {
    $d = json_decode((string)$r['data'], true);
    return ['id' => (int)$r['id'], 'patient_id' => $r['patient_id'], 'date' => $r['rx_date'], 'age' => $r['age'],
        'data' => is_array($d) ? $d : new stdClass(), 'created_at' => (int)$r['created_at'], 'updated_at' => (int)$r['updated_at']];
}
function export_patients(int $uid): array {
    $pa = []; $ra = [];
    foreach (rows('SELECT * FROM patients WHERE user_id=? ORDER BY created_at', [$uid]) as $p) $pa[] = pat_json($p);
    foreach (rows('SELECT * FROM prescriptions WHERE user_id=? ORDER BY id', [$uid]) as $r)
        $ra[] = ['patient_id' => $r['patient_id'], 'rx_date' => $r['rx_date'], 'age' => $r['age'], 'data' => $r['data'],
            'created_at' => (int)$r['created_at'], 'updated_at' => (int)$r['updated_at']];
    return ['format' => 'rxpad-patients', 'version' => 1, 'patients' => $pa, 'prescriptions' => $ra];
}
function own_patient(int $uid, string $id): array {
    $p = row('SELECT * FROM patients WHERE id=? AND user_id=?', [strtoupper(trim($id)), $uid]);
    if (!$p) fail('Patient not found', 404);
    return $p;
}
function rm_dir(string $d): void {
    if (!is_dir($d)) return;
    foreach (scandir($d) ?: [] as $f) { if ($f === '.' || $f === '..') continue; $p = "$d/$f"; is_dir($p) ? rm_dir($p) : @unlink($p); }
    @rmdir($d);
}

switch ($action) {

/* ---------------- setup / sign up / sign in ---------------- */
case 'setup_admin': {
    if (has_admin()) fail('Admin already exists');
    $name = trim(s($B, 'name')); $email = trim(s($B, 'email')); $pw = s($B, 'password');
    if ($name === '' || !valid_email($email) || strlen($pw) < 6) fail('Enter your name, a valid e-mail and a password of at least 6 characters');
    q("INSERT INTO users(email,name,pass_hash,role,status,created_at) VALUES(?,?,?,?,?,?)",
        [$email, $name, password_hash($pw, PASSWORD_DEFAULT), 'admin', 'approved', now_ms()]);
    $id = (int)db()->lastInsertId();
    set_setting($id, 'doctor', json_encode(['name' => $name, 'email' => $email], JSON_UNESCAPED_UNICODE));
    foreach (['BP | unit=mmHg', 'Pulse | unit=/min', 'Temperature | unit=°F', 'SpO2 | unit=%', 'Weight | unit=kg', 'RBS | unit=mmol/L', 'Dengue IgM | options=Positive;Negative;Equivocal'] as $f) li_add($id, 'findings', $f);
    session_regenerate_id(true);
    $_SESSION['uid'] = $id;
    csrf_token();
    out(['ok' => true, 'user' => me(), 'csrf' => csrf_token()]);
}
case 'signup': {
    if (!has_admin()) fail('The site is not set up yet');
    $name = trim(s($B, 'name')); $email = trim(s($B, 'email')); $pw = s($B, 'password');
    if (mb_strlen($name) < 2) fail('Enter your name');
    if (!valid_email($email)) fail('Enter a valid e-mail address');
    if (strlen($pw) < 6) fail('Password must be at least 6 characters');
    if (val('SELECT 1 FROM users WHERE email=?', [$email])) fail('This e-mail is already registered');
    q("INSERT INTO users(email,name,pass_hash,role,status,created_at) VALUES(?,?,?,?,?,?)",
        [$email, $name, password_hash($pw, PASSWORD_DEFAULT), 'doctor', 'pending', now_ms()]);
    $id = (int)db()->lastInsertId();
    set_setting($id, 'doctor', json_encode([
        'name' => $name, 'email' => $email, 'bmdc' => trim(s($B, 'bmdc')), 'specialty' => trim(s($B, 'specialty')),
        'phone' => trim(s($B, 'phone')), 'degrees' => trim(s($B, 'degrees'))], JSON_UNESCAPED_UNICODE));
    out(['ok' => true, 'message' => 'Account created. You can sign in after the admin approves it.']);
}
case 'login': {
    $email = trim(s($B, 'email')); $pw = s($B, 'password');
    $u = row('SELECT * FROM users WHERE email=?', [$email]);
    if (!$u || !password_verify($pw, $u['pass_hash'])) { usleep(600000); fail('Wrong e-mail or password', 401); }
    if ($u['status'] === 'pending') fail('Your account is waiting for approval by the admin.', 403);
    if ($u['status'] !== 'approved') fail('This account is disabled. Contact the admin.', 403);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    q('UPDATE users SET last_login=? WHERE id=?', [now_ms(), $u['id']]);
    out(['ok' => true, 'user' => me(), 'csrf' => csrf_token()]);
}
case 'logout': {
    unset($_SESSION['uid']);
    session_regenerate_id(true);
    out(['ok' => true, 'csrf' => csrf_token()]);
}
case 'change_password': {
    $u = need_login();
    $cur = row('SELECT pass_hash FROM users WHERE id=?', [$u['id']]);
    if (!password_verify(s($B, 'old'), $cur['pass_hash'])) fail('Current password is wrong');
    if (strlen(s($B, 'new')) < 6) fail('New password must be at least 6 characters');
    q('UPDATE users SET pass_hash=? WHERE id=?', [password_hash(s($B, 'new'), PASSWORD_DEFAULT), $u['id']]);
    out(['ok' => true]);
}

/* ---------------- settings / profile ---------------- */
case 'settings_get': {
    $u = need_login(); $id = (int)$u['id'];
    $doctor = json_decode(setting($id, 'doctor', '{}'), true) ?: [];
    $smtp = json_decode(setting($id, 'smtp', '{}'), true) ?: [];
    $hasPass = ($smtp['password'] ?? '') !== '';
    unset($smtp['password']);
    out([
        'doctor' => (object)$doctor,
        'smtp' => (object)$smtp, 'smtp_has_pass' => $hasPass,
        'mail_body' => setting($id, 'mail_body', "Please find the attached prescription for {patient}.\n\n{doctor}"),
        'recipients' => json_decode(setting($id, 'recipients', '[]'), true) ?: [],
        'default_recipient' => setting($id, 'default_recipient'),
        'page_layout' => setting($id, 'page_layout'),
        'qr_caption' => setting($id, 'qr_caption', 'Scan to open patient'),
        'current_chamber' => setting($id, 'current_chamber'),
        'drug_limit' => (int)setting($id, 'drug_limit', '40'),
        'search_indications' => setting($id, 'search_indications', '1') === '1',
        'has_photo' => (bool)glob(DATA . "/uploads/$id/photo.*"),
        'has_watermark' => (bool)glob(DATA . "/uploads/$id/watermark.*"),
        'engine' => drug_active(),
    ]);
}
case 'settings_set': {
    $u = need_login(); $id = (int)$u['id'];
    foreach ($B as $k => $v) {
        switch ($k) {
            case 'doctor':
                if (!is_array($v)) break;
                $keep = [];
                foreach (['name', 'degrees', 'specialty', 'bmdc', 'phone', 'email'] as $f) $keep[$f] = trim((string)($v[$f] ?? ''));
                set_setting($id, 'doctor', json_encode($keep, JSON_UNESCAPED_UNICODE));
                break;
            case 'smtp':
                if (!is_array($v)) break;
                $old = json_decode(setting($id, 'smtp', '{}'), true) ?: [];
                $new = ['host' => trim((string)($v['host'] ?? '')), 'port' => (int)($v['port'] ?? 465), 'security' => in_array(($v['security'] ?? ''), ['SSL', 'STARTTLS', 'NONE'], true) ? $v['security'] : 'SSL',
                    'username' => trim((string)($v['username'] ?? '')), 'from' => trim((string)($v['from'] ?? '')), 'from_name' => trim((string)($v['from_name'] ?? ''))];
                $pw = (string)($v['password'] ?? '');
                $new['password'] = $pw !== '' ? $pw : ($old['password'] ?? '');
                if (!empty($v['clear_password'])) $new['password'] = '';
                set_setting($id, 'smtp', json_encode($new, JSON_UNESCAPED_UNICODE));
                break;
            case 'recipients':
                if (!is_array($v)) break;
                $list = [];
                foreach ($v as $r) if (is_array($r) && valid_email(trim((string)($r['email'] ?? '')))) $list[] = ['email' => trim($r['email']), 'label' => trim((string)($r['label'] ?? ''))];
                set_setting($id, 'recipients', json_encode($list, JSON_UNESCAPED_UNICODE));
                break;
            case 'mail_body': case 'default_recipient': case 'qr_caption': case 'current_chamber':
                set_setting($id, $k, (string)$v); break;
            case 'page_layout':
                if (is_string($v) && strlen($v) < 200000) set_setting($id, 'page_layout', $v);
                break;
            case 'drug_limit':
                set_setting($id, 'drug_limit', (string)max(5, min(200, (int)$v))); break;
            case 'search_indications':
                set_setting($id, 'search_indications', $v ? '1' : '0'); break;
        }
    }
    out(['ok' => true]);
}
case 'image_upload': {
    $u = need_login(); $id = (int)$u['id'];
    $kind = s($B, 'kind');
    if (!image_kind_ok($kind)) fail('Bad request');
    if (strncmp($kind, 'img_', 4) === 0 && !glob(DATA . "/uploads/$id/$kind.*") && count(glob(DATA . "/uploads/$id/img_*.*") ?: []) >= 30) fail('Too many pictures (max 30)');
    $d = s($B, 'data');
    if (!preg_match('~^data:image/(jpeg|png|webp);base64,(.+)$~s', $d, $m)) fail('Choose a JPG, PNG or WebP image');
    $bin = base64_decode($m[2], true);
    if ($bin === false || strlen($bin) > 3 * 1024 * 1024) fail('Image is too large');
    if (!@getimagesizefromstring($bin)) fail('This is not an image');
    $dir = DATA . "/uploads/$id";
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    foreach (glob("$dir/$kind.*") ?: [] as $f) @unlink($f);
    file_put_contents("$dir/$kind." . ($m[1] === 'jpeg' ? 'jpg' : $m[1]), $bin);
    out(['ok' => true]);
}
case 'image_delete': {
    $u = need_login(); $kind = s($B, 'kind');
    if (!image_kind_ok($kind)) fail('Bad request');
    foreach (glob(DATA . "/uploads/{$u['id']}/$kind.*") ?: [] as $f) @unlink($f);
    out(['ok' => true]);
}

/* ---------------- chambers ---------------- */
case 'chambers_list': {
    $u = need_login();
    out(['chambers' => rows('SELECT id,name,address,phone,lat,lon,note FROM chambers WHERE user_id=? ORDER BY pos, rowid', [$u['id']]),
        'current' => setting((int)$u['id'], 'current_chamber')]);
}
case 'chamber_save': {
    $u = need_login(); $uid = (int)$u['id'];
    $c = $B['chamber'] ?? [];
    $id = s($c, 'id');
    $vals = [trim(s($c, 'name')), trim(s($c, 'address')), trim(s($c, 'phone')), trim(s($c, 'lat')), trim(s($c, 'lon')), trim(s($c, 'note'))];
    if ($id !== '' && val('SELECT 1 FROM chambers WHERE id=? AND user_id=?', [$id, $uid])) {
        q('UPDATE chambers SET name=?,address=?,phone=?,lat=?,lon=?,note=? WHERE id=? AND user_id=?', array_merge($vals, [$id, $uid]));
    } else {
        $id = bin2hex(random_bytes(8));
        q('INSERT INTO chambers(id,user_id,name,address,phone,lat,lon,note,pos) VALUES(?,?,?,?,?,?,?,?,?)',
            array_merge([$id, $uid], $vals, [(int)val('SELECT COALESCE(MAX(pos),0)+1 FROM chambers WHERE user_id=?', [$uid])]));
    }
    if (setting($uid, 'current_chamber') === '' || !val('SELECT 1 FROM chambers WHERE id=? AND user_id=?', [setting($uid, 'current_chamber'), $uid])) set_setting($uid, 'current_chamber', $id);
    out(['ok' => true, 'id' => $id]);
}
case 'chamber_delete': {
    $u = need_login(); $uid = (int)$u['id'];
    q('DELETE FROM chambers WHERE id=? AND user_id=?', [s($B, 'id'), $uid]);
    if (!val('SELECT 1 FROM chambers WHERE id=? AND user_id=?', [setting($uid, 'current_chamber'), $uid])) {
        $first = val('SELECT id FROM chambers WHERE user_id=? ORDER BY pos, rowid LIMIT 1', [$uid]);
        set_setting($uid, 'current_chamber', (string)($first ?? ''));
    }
    out(['ok' => true]);
}

/* ---------------- patients ---------------- */
case 'patients_list': {
    $u = need_login(); $uid = (int)$u['id'];
    $qq = trim(s($B, 'q')); $limit = max(10, min(300, (int)($B['limit'] ?? 100))); $offset = max(0, (int)($B['offset'] ?? 0));
    $args = [$uid]; $where = 'p.user_id=?';
    if ($qq !== '') {
        $like = '%' . like_esc($qq) . '%';
        $where .= " AND (p.name LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\')";
        array_push($args, $like, $like, $like);
    }
    $total = (int)val('SELECT COUNT(*) FROM patients WHERE user_id=?', [$uid]);
    $matched = (int)val("SELECT COUNT(*) FROM patients p WHERE $where", $args);
    $list = rows("SELECT p.*, (SELECT COUNT(*) FROM prescriptions r WHERE r.patient_id=p.id) AS rx_count,
        (SELECT MAX(r.rx_date) FROM prescriptions r WHERE r.patient_id=p.id) AS last_rx
        FROM patients p WHERE $where ORDER BY p.created_at DESC LIMIT $limit OFFSET $offset", $args);
    out(['total' => $total, 'matched' => $matched, 'patients' => array_map(fn($p) => pat_json($p) + ['rx_count' => (int)$p['rx_count'], 'last_rx' => (string)($p['last_rx'] ?? '')], $list)]);
}
case 'patient_get': {
    $u = need_login(); $uid = (int)$u['id'];
    $p = own_patient($uid, s($B, 'id'));
    $rx = rows('SELECT * FROM prescriptions WHERE patient_id=? AND user_id=? ORDER BY rx_date DESC, id DESC', [$p['id'], $uid]);
    out(['patient' => pat_json($p), 'prescriptions' => array_map('rx_json', $rx)]);
}
case 'patient_save': {
    $u = need_login(); $uid = (int)$u['id'];
    $p = $B['patient'] ?? [];
    $name = trim(s($p, 'name'));
    if ($name === '') fail('Patient name is required');
    $f = fn($k) => trim(s($p, $k));
    $id = strtoupper(trim(s($p, 'id')));
    if ($id === '') {
        $id = new_patient_id();
        q('INSERT INTO patients(id,user_id,name,age,sex,phone,address,blood_group,weight,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            [$id, $uid, $name, $f('age'), $f('sex'), $f('phone'), $f('address'), $f('blood_group'), $f('weight'), $f('notes'), now_ms()]);
    } else {
        own_patient($uid, $id);
        q('UPDATE patients SET name=?,age=?,sex=?,phone=?,address=?,blood_group=?,weight=?,notes=? WHERE id=? AND user_id=?',
            [$name, $f('age'), $f('sex'), $f('phone'), $f('address'), $f('blood_group'), $f('weight'), $f('notes'), $id, $uid]);
    }
    out(['ok' => true, 'id' => $id]);
}
case 'patient_delete': {
    $u = need_login(); $uid = (int)$u['id'];
    $p = own_patient($uid, s($B, 'id'));
    q('DELETE FROM prescriptions WHERE patient_id=? AND user_id=?', [$p['id'], $uid]);
    q('DELETE FROM patients WHERE id=? AND user_id=?', [$p['id'], $uid]);
    out(['ok' => true]);
}
case 'patient_lookup': {
    $u = need_login();
    $id = strtoupper(trim(s($B, 'id')));
    out(['found' => (bool)val('SELECT 1 FROM patients WHERE id=? AND user_id=?', [$id, $u['id']]), 'id' => $id]);
}
case 'patients_export': {
    $u = need_login();
    out(export_patients((int)$u['id']));
}
case 'patients_import': {
    $u = need_login(); $uid = (int)$u['id'];
    $root = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', s($B, 'text')), true);
    if (!is_array($root) || ($root['format'] ?? '') !== 'rxpad-patients') fail('This is not an RxPad patient backup file');
    $newP = $skipP = $newR = $skipR = 0;
    db()->beginTransaction();
    try {
        foreach (($root['patients'] ?? []) as $o) {
            $id = strtoupper(trim((string)($o['id'] ?? '')));
            if ($id === '') continue;
            if (val('SELECT 1 FROM patients WHERE id=?', [$id])) { $skipP++; continue; }
            q('INSERT INTO patients(id,user_id,name,age,sex,phone,address,blood_group,weight,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                [$id, $uid, (string)($o['name'] ?? ''), (string)($o['age'] ?? ''), (string)($o['sex'] ?? ''), (string)($o['phone'] ?? ''),
                    (string)($o['address'] ?? ''), (string)($o['blood_group'] ?? ''), (string)($o['weight'] ?? ''), (string)($o['notes'] ?? ''),
                    (int)($o['created_at'] ?? now_ms())]);
            $newP++;
        }
        foreach (($root['prescriptions'] ?? []) as $o) {
            $pid = strtoupper(trim((string)($o['patient_id'] ?? '')));
            if (!val('SELECT 1 FROM patients WHERE id=? AND user_id=?', [$pid, $uid])) { $skipR++; continue; }
            $created = (int)($o['created_at'] ?? now_ms());
            if (val('SELECT 1 FROM prescriptions WHERE patient_id=? AND created_at=?', [$pid, $created])) { $skipR++; continue; }
            q('INSERT INTO prescriptions(user_id,patient_id,rx_date,age,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                [$uid, $pid, (string)($o['rx_date'] ?? ''), (string)($o['age'] ?? ''), (string)($o['data'] ?? '{}'), $created, (int)($o['updated_at'] ?? $created)]);
            $newR++;
        }
        db()->commit();
    } catch (Throwable $e) { db()->rollBack(); throw $e; }
    out(['message' => "Patients: $newP added, $skipP already existed. Prescriptions: $newR added, $skipR skipped."]);
}

/* ---------------- prescriptions ---------------- */
case 'rx_get': {
    $u = need_login();
    $r = row('SELECT * FROM prescriptions WHERE id=? AND user_id=?', [(int)($B['id'] ?? 0), $u['id']]);
    if (!$r) fail('Prescription not found', 404);
    out(['rx' => rx_json($r)]);
}
case 'rx_save': {
    $u = need_login(); $uid = (int)$u['id'];
    $rx = $B['rx'] ?? [];
    $p = own_patient($uid, s($rx, 'patient_id'));
    $data = is_array($rx['data'] ?? null) ? $rx['data'] : [];
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $now = now_ms();
    $id = (int)($rx['id'] ?? 0);
    if ($id && val('SELECT 1 FROM prescriptions WHERE id=? AND user_id=?', [$id, $uid])) {
        q('UPDATE prescriptions SET rx_date=?, age=?, data=?, updated_at=? WHERE id=? AND user_id=?', [s($rx, 'date'), s($rx, 'age'), $json, $now, $id, $uid]);
    } else {
        q('INSERT INTO prescriptions(user_id,patient_id,rx_date,age,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
            [$uid, $p['id'], s($rx, 'date'), s($rx, 'age'), $json, $now, $now]);
        $id = (int)db()->lastInsertId();
    }
    // every custom entry typed in this prescription is remembered in the doctor's own suggestion lists
    foreach (['complaints', 'history', 'investigation', 'diagnosis'] as $t) foreach (($data[$t] ?? []) as $v) li_add($uid, $t, (string)$v);
    foreach (($data['followUp'] ?? []) as $v) li_add($uid, 'follow_up', (string)$v);
    foreach (($data['advice'] ?? []) as $v) li_upsert_advice($uid, (string)$v);
    foreach (($data['findings'] ?? []) as $f) if (is_array($f)) li_add($uid, 'findings', (string)($f['type'] ?? ''));
    foreach (($data['medications'] ?? []) as $m) if (is_array($m)) li_add($uid, 'instruction', (string)($m['instruction'] ?? ''));
    out(['ok' => true, 'id' => $id]);
}
case 'rx_delete': {
    $u = need_login();
    q('DELETE FROM prescriptions WHERE id=? AND user_id=?', [(int)($B['id'] ?? 0), $u['id']]);
    out(['ok' => true]);
}

/* ---------------- suggestion lists ---------------- */
case 'lists_items': {
    $u = need_login();
    $type = s($B, 'type');
    if (!in_array($type, LIST_TYPES, true)) fail('Bad list');
    out(['items' => li_items((int)$u['id'], $type, s($B, 'scope', 'all'))]);
}
case 'lists_counts': {
    $u = need_login(); $uid = (int)$u['id'];
    $c = [];
    foreach (LIST_TYPES as $t) $c[$t] = ['all' => li_count($uid, $t), 'own' => (int)val('SELECT COUNT(*) FROM list_items WHERE owner_id=? AND list_type=?', [$uid, $t])];
    out(['counts' => $c]);
}
case 'lists_suggest': {
    $u = need_login();
    $type = s($B, 'type');
    if (!in_array($type, LIST_TYPES, true)) fail('Bad list');
    out(['items' => li_suggest((int)$u['id'], $type, s($B, 'q'))]);
}
case 'lists_add': {
    $u = need_login();
    out(['ok' => li_add((int)$u['id'], s($B, 'type'), s($B, 'name'))]);
}
case 'lists_add_many': {
    $u = need_login(); $uid = (int)$u['id'];
    $type = s($B, 'type');
    if (!in_array($type, LIST_TYPES, true)) fail('Bad list');
    $text = s($B, 'text');
    if (trim($text) === '') fail('Nothing to add');
    $values = $type === 'advice' ? array_map('advice_encode', advice_parse_blocks($text)) : li_split($text, s($B, 'sep', "\n") === '' ? ',' : s($B, 'sep', "\n"));
    out(li_add_many($uid, $type, $values));
}
case 'lists_update': {
    $u = need_login();
    out(['ok' => li_update((int)$u['id'], s($B, 'type'), s($B, 'old'), s($B, 'new'))]);
}
case 'lists_delete': {
    $u = need_login();
    li_delete((int)$u['id'], s($B, 'type'), s($B, 'name'));
    out(['ok' => true]);
}
case 'lists_export_text': {
    $u = need_login();
    $type = s($B, 'type');
    if (!in_array($type, LIST_TYPES, true)) fail('Bad list');
    out(['text' => li_export_text((int)$u['id'], $type, s($B, 'sep', "\n"), s($B, 'scope', 'own'))]);
}
case 'lists_export_json': {
    $u = need_login();
    out(li_export_json((int)$u['id'], s($B, 'scope', 'own')));
}
case 'lists_import': {
    $u = need_login();
    out(li_import_text((int)$u['id'], s($B, 'text')));
}

/* ---------------- medicine engines (read: every doctor) ---------------- */
case 'drug_search': {
    $u = need_login(); $uid = (int)$u['id'];
    $limit = (int)setting($uid, 'drug_limit', '40');
    out(['results' => drug_search(s($B, 'q'), $limit, setting($uid, 'search_indications', '1') === '1'), 'has_db' => count(drug_on()) > 0]);
}
case 'drug_details': {
    need_login();
    $d = drug_details(s($B, 'url'), s($B, 'engine'));
    out(['details' => $d]);
}
case 'drug_status': {
    need_login();
    out(['has_db' => count(drug_on()) > 0, 'engines' => drug_on()]);
}

/* ---------------- e-mail ---------------- */
case 'mail_send': {
    $u = need_login(); $uid = (int)$u['id'];
    $smtp = json_decode(setting($uid, 'smtp', '{}'), true) ?: [];
    $to = [];
    foreach ((array)($B['to'] ?? []) as $t) { $t = trim((string)$t); if (valid_email($t)) $to[] = $t; }
    $to = array_values(array_unique($to));
    $pdf = null; $name = null;
    if (!empty($B['pdf'])) {
        $pdf = base64_decode((string)$B['pdf'], true);
        if ($pdf === false) fail('Bad attachment');
        $name = preg_replace('/[^A-Za-z0-9._-]+/', '_', s($B, 'filename', 'prescription.pdf'));
    }
    try {
        Smtp::send(['host' => $smtp['host'] ?? '', 'port' => $smtp['port'] ?? 465, 'security' => $smtp['security'] ?? 'SSL',
            'username' => $smtp['username'] ?? '', 'password' => $smtp['password'] ?? '',
            'from' => ($smtp['from'] ?? '') ?: ($smtp['username'] ?? ''), 'from_name' => $smtp['from_name'] ?? ''],
            $to, s($B, 'subject'), s($B, 'body'), $name, $pdf);
    } catch (Throwable $e) { fail('E-mail failed: ' . $e->getMessage(), 502); }
    out(['ok' => true]);
}
case 'mail_test': {
    $u = need_login(); $uid = (int)$u['id'];
    $smtp = json_decode(setting($uid, 'smtp', '{}'), true) ?: [];
    $to = trim(s($B, 'to'));
    if (!valid_email($to)) fail('Enter a valid e-mail address');
    try {
        Smtp::send(['host' => $smtp['host'] ?? '', 'port' => $smtp['port'] ?? 465, 'security' => $smtp['security'] ?? 'SSL',
            'username' => $smtp['username'] ?? '', 'password' => $smtp['password'] ?? '',
            'from' => ($smtp['from'] ?? '') ?: ($smtp['username'] ?? ''), 'from_name' => $smtp['from_name'] ?? ''],
            [$to], 'WebRxPad test e-mail', "This is a test message from WebRxPad.\nYour e-mail settings work.");
    } catch (Throwable $e) { fail('E-mail failed: ' . $e->getMessage(), 502); }
    out(['ok' => true]);
}

/* ================= ADMIN ================= */
case 'admin_users': {
    need_admin();
    out(['users' => user_rows_summary(), 'engines' => array_map(fn($e) => ['engine' => $e, 'stats' => drug_stats($e), 'on' => setting(0, 'engine_on_' . $e, '1') === '1'], ENGINES)]);
}
case 'admin_user_set': {
    $a = need_admin();
    $id = (int)($B['id'] ?? 0);
    $status = s($B, 'status');
    if (!in_array($status, ['approved', 'pending', 'blocked'], true)) fail('Bad status');
    if ($id === (int)$a['id']) fail('You cannot change your own status');
    q('UPDATE users SET status=? WHERE id=?', [$status, $id]);
    out(['ok' => true]);
}
case 'admin_user_role': {
    $a = need_admin();
    $id = (int)($B['id'] ?? 0);
    $role = s($B, 'role');
    if (!in_array($role, ['admin', 'doctor'], true)) fail('Bad role');
    if ($id === (int)$a['id']) fail('You cannot change your own role');
    q('UPDATE users SET role=? WHERE id=?', [$role, $id]);
    out(['ok' => true]);
}
case 'admin_user_password': {
    need_admin();
    if (strlen(s($B, 'password')) < 6) fail('Password must be at least 6 characters');
    q('UPDATE users SET pass_hash=? WHERE id=?', [password_hash(s($B, 'password'), PASSWORD_DEFAULT), (int)($B['id'] ?? 0)]);
    out(['ok' => true]);
}
case 'admin_user_delete': {
    $a = need_admin();
    $id = (int)($B['id'] ?? 0);
    if ($id === (int)$a['id']) fail('You cannot delete your own account');
    db()->beginTransaction();
    foreach (['prescriptions' => 'user_id', 'patients' => 'user_id', 'chambers' => 'user_id', 'list_items' => 'owner_id', 'settings' => 'user_id', 'users' => 'id'] as $t => $c)
        q("DELETE FROM $t WHERE $c=?", [$id]);
    db()->commit();
    rm_dir(DATA . "/uploads/$id");
    out(['ok' => true]);
}
case 'admin_user_patients': {
    need_admin();
    $uid = (int)($B['id'] ?? 0);
    $user = row('SELECT id,name,email FROM users WHERE id=?', [$uid]);
    if (!$user) fail('User not found', 404);
    $qq = trim(s($B, 'q')); $args = [$uid]; $where = 'p.user_id=?';
    if ($qq !== '') { $like = '%' . like_esc($qq) . '%'; $where .= " AND (p.name LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\')"; array_push($args, $like, $like, $like); }
    $list = rows("SELECT p.*, (SELECT COUNT(*) FROM prescriptions r WHERE r.patient_id=p.id) AS rx_count,
        (SELECT MAX(r.rx_date) FROM prescriptions r WHERE r.patient_id=p.id) AS last_rx FROM patients p WHERE $where ORDER BY p.created_at DESC LIMIT 300", $args);
    out(['user' => $user, 'total' => (int)val('SELECT COUNT(*) FROM patients WHERE user_id=?', [$uid]),
        'patients' => array_map(fn($p) => pat_json($p) + ['rx_count' => (int)$p['rx_count'], 'last_rx' => (string)($p['last_rx'] ?? '')], $list)]);
}
case 'admin_user_patient': {
    need_admin();
    $uid = (int)($B['user_id'] ?? 0);
    $p = row('SELECT * FROM patients WHERE id=? AND user_id=?', [strtoupper(s($B, 'id')), $uid]);
    if (!$p) fail('Patient not found', 404);
    out(['patient' => pat_json($p), 'prescriptions' => array_map('rx_json', rows('SELECT * FROM prescriptions WHERE patient_id=? AND user_id=? ORDER BY rx_date DESC, id DESC', [$p['id'], $uid]))]);
}
case 'admin_user_export_patients': {
    need_admin();
    out(export_patients((int)($B['id'] ?? 0)));
}
case 'admin_user_lists': {
    need_admin();
    $uid = (int)($B['id'] ?? 0);
    $type = s($B, 'type');
    if (!in_array($type, LIST_TYPES, true)) fail('Bad list');
    $c = [];
    foreach (LIST_TYPES as $t) $c[$t] = (int)val('SELECT COUNT(*) FROM list_items WHERE owner_id=? AND list_type=?', [$uid, $t]);
    out(['items' => li_items($uid, $type, 'own'), 'counts' => $c]);
}
case 'admin_user_export_lists': {
    need_admin();
    $uid = (int)($B['id'] ?? 0);
    $type = s($B, 'type');
    if ($type !== '' && in_array($type, LIST_TYPES, true)) out(['text' => li_export_text($uid, $type, s($B, 'sep', "\n"), 'own')]);
    out(li_export_json($uid, 'own'));
}
case 'admin_engine_on': {
    need_admin();
    $e = s($B, 'engine');
    if (!in_array($e, ENGINES, true)) fail('Bad engine');
    set_setting(0, 'engine_on_' . $e, !empty($B['on']) ? '1' : '0');
    out(['ok' => true]);
}
case 'admin_engine_default': {
    need_admin();
    $e = s($B, 'engine');
    if (!in_array($e, ENGINES, true)) fail('Bad engine');
    set_setting(0, 'drug_engine', $e);
    out(['ok' => true]);
}
case 'admin_engine_delete': {
    need_admin();
    $e = s($B, 'engine');
    if (!in_array($e, ENGINES, true)) fail('Bad engine');
    @unlink(drug_file($e)); @unlink(drug_file($e) . '-wal'); @unlink(drug_file($e) . '-shm'); @unlink(drug_file($e) . '-journal');
    out(['ok' => true]);
}
case 'engine_upload': {
    // chunked upload (works with small upload limits): multipart fields engine, index, total, chunk
    need_admin();
    $e = $_POST['engine'] ?? '';
    if (!in_array($e, ENGINES, true)) fail('Bad engine');
    $idx = (int)($_POST['index'] ?? 0); $total = (int)($_POST['total'] ?? 1);
    if (empty($_FILES['chunk']) || $_FILES['chunk']['error'] !== UPLOAD_ERR_OK) fail('Upload failed (chunk error ' . ($_FILES['chunk']['error'] ?? '?') . ')');
    $part = DATA . "/upload_$e.part";
    if ($idx === 0) @unlink($part);
    file_put_contents($part, file_get_contents($_FILES['chunk']['tmp_name']), FILE_APPEND);
    if ($idx + 1 < $total) out(['ok' => true, 'done' => false]);
    try { drug_validate($part, $e); }
    catch (Throwable $ex) { @unlink($part); fail($ex->getMessage()); }
    @unlink(drug_file($e) . '-wal'); @unlink(drug_file($e) . '-shm');
    rename($part, drug_file($e));
    out(['ok' => true, 'done' => true, 'stats' => drug_stats($e)]);
}

default:
    fail('Unknown action', 404);
}
