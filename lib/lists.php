<?php
declare(strict_types=1);

/* Suggestion lists. Items owned by an admin are shared with every doctor (read-only for them).
   A doctor sees: shared (admin) items + his own items, and can only change his own. */

function li_visible(): string { return "(owner_id = :me OR owner_id IN (SELECT id FROM users WHERE role='admin'))"; }

function li_plain(string $type, string $raw): string {
    if ($type === 'findings') return plain_text(finding_parse($raw)['name']);
    return $type === 'advice' ? plain_text(advice_decode($raw)['c']) : plain_text($raw);
}
function li_normalize(string $type, string $raw): string {
    if ($type === 'findings') return finding_encode(finding_parse($raw));
    return $type === 'advice' ? advice_normalize($raw) : trim($raw);
}

/** @return array<int,array{name:string,plain:string,shared:bool,owner_id:int}> */
function li_items(int $uid, string $type, string $scope = 'all', string $filter = ''): array {
    if ($scope === 'own') {
        $rows = rows('SELECT name, plain, owner_id FROM list_items WHERE owner_id=? AND list_type=? ORDER BY plain COLLATE NOCASE', [$uid, $type]);
    } else {
        $rows = rows('SELECT name, plain, owner_id FROM list_items WHERE list_type=:t AND ' . li_visible() . ' ORDER BY plain COLLATE NOCASE', ['t' => $type, 'me' => $uid]);
    }
    $admins = array_column(rows("SELECT id FROM users WHERE role='admin'"), 'id');
    $out = [];
    foreach ($rows as $r) {
        $shared = ((int)$r['owner_id'] !== $uid) && in_array($r['owner_id'], $admins);
        $out[] = ['name' => $r['name'], 'plain' => $r['plain'], 'shared' => $shared, 'owner_id' => (int)$r['owner_id']];
    }
    return $out;
}

function li_suggest(int $uid, string $type, string $query, int $limit = 6): array {
    $qq = trim($query);
    if ($qq === '') return [];
    $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $qq) . '%';
    $rows = rows("SELECT name FROM list_items WHERE list_type=:t AND plain LIKE :l ESCAPE '\\' AND " . li_visible() .
        " ORDER BY plain COLLATE NOCASE LIMIT " . (int)$limit, ['t' => $type, 'l' => $like, 'me' => $uid]);
    return array_column($rows, 'name');
}

function li_count(int $uid, string $type): int {
    return (int)val('SELECT COUNT(*) FROM list_items WHERE list_type=:t AND ' . li_visible(), ['t' => $type, 'me' => $uid]);
}

function li_add(int $uid, string $type, string $name): bool {
    if (!in_array($type, LIST_TYPES, true) || trim($name) === '') return false;
    $n = li_normalize($type, $name);
    $plain = li_plain($type, $n);
    if ($plain === '') return false;
    $exists = val('SELECT 1 FROM list_items WHERE list_type=:t AND (name=:n OR plain=:p COLLATE NOCASE) AND ' . li_visible() . ' LIMIT 1',
        ['t' => $type, 'n' => $n, 'p' => $plain, 'me' => $uid]);
    if ($exists) return false;
    q('INSERT OR IGNORE INTO list_items(owner_id,list_type,name,plain) VALUES(?,?,?,?)', [$uid, $type, $n, $plain]);
    return (bool)val('SELECT changes()');
}

function li_add_many(int $uid, string $type, array $values): array {
    $added = 0; $skipped = 0;
    db()->beginTransaction();
    try {
        foreach ($values as $v) { if (li_add($uid, $type, (string)$v)) $added++; else $skipped++; }
        db()->commit();
    } catch (Throwable $e) { db()->rollBack(); throw $e; }
    return ['added' => $added, 'skipped' => $skipped];
}

/** Advice saved with a prescription: same caption -> its text is updated; changed caption -> new entry (own items only). */
function li_upsert_advice(int $uid, string $raw): void {
    if (trim($raw) === '') return;
    $n = advice_normalize($raw);
    $plain = li_plain('advice', $n);
    if ($plain === '') return;
    $old = val("SELECT name FROM list_items WHERE owner_id=? AND list_type='advice' AND plain=? COLLATE NOCASE LIMIT 1", [$uid, $plain]);
    if ($old === null) {
        $shared = val("SELECT 1 FROM list_items WHERE list_type='advice' AND name=:n AND " . li_visible(), ['n' => $n, 'me' => $uid]);
        if (!$shared) q("INSERT OR IGNORE INTO list_items(owner_id,list_type,name,plain) VALUES(?,?,?,?)", [$uid, 'advice', $n, $plain]);
        return;
    }
    if ($old === $n) return;
    q("UPDATE list_items SET name=?, plain=? WHERE owner_id=? AND list_type='advice' AND name=?", [$n, $plain, $uid, $old]);
}

function li_update(int $uid, string $type, string $old, string $new): bool {
    if (trim($new) === '') return false;
    $n = li_normalize($type, $new);
    if ($n === $old) return true;
    $taken = val('SELECT 1 FROM list_items WHERE owner_id=? AND list_type=? AND name=?', [$uid, $type, $n]);
    if ($taken) return false;
    $st = q('UPDATE list_items SET name=?, plain=? WHERE owner_id=? AND list_type=? AND name=?', [$n, li_plain($type, $n), $uid, $type, $old]);
    return $st->rowCount() > 0;
}

function li_delete(int $uid, string $type, string $name): void {
    q('DELETE FROM list_items WHERE owner_id=? AND list_type=? AND name=?', [$uid, $type, $name]);
}

function li_normalize_type(string $t): string {
    $s = strtolower(str_replace([' ', '-'], '_', trim($t, " \t\"")));
    return match ($s) { 'advise' => 'advice', 'followup' => 'follow_up', 'complaint' => 'complaints',
        'instructions', 'medicine_instruction' => 'instruction', default => $s };
}

function li_export_json(int $uid, string $scope = 'own'): array {
    $o = [];
    foreach (LIST_TYPES as $t) $o[$t] = array_column(li_items($uid, $t, $scope), 'name');
    return $o;
}

function li_export_text(int $uid, string $type, string $sep, string $scope = 'own'): string {
    $items = array_column(li_items($uid, $type, $scope), 'name');
    if ($type === 'advice') return advice_block_text(array_map('advice_decode', $items));
    return implode($sep, $items);
}

function li_split(string $text, string $sep): array {
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $text);
    $parts = ($sep === "\n") ? preg_split('~\r?\n~', $text) : explode($sep, $text);
    $out = [];
    foreach ($parts as $p) { $p = trim($p); if ($p !== '') $out[] = $p; }
    return $out;
}

/** Import the same formats as the Android app: JSON {type:[...]}, text with [type] sections / "type,value" lines. */
function li_import_text(int $uid, string $text): array {
    $pairs = [];
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $text);
    if (str_starts_with(ltrim($text), '{')) {
        $o = json_decode($text, true);
        if (is_array($o)) foreach ($o as $k => $arr) if (is_array($arr)) foreach ($arr as $v) if (is_scalar($v)) $pairs[] = [$k, (string)$v];
    } else {
        $cur = '';
        foreach (preg_split('~\r?\n~', $text) as $raw) {
            $line = trim($raw);
            if ($line === '' || $line[0] === '#') continue;
            if ($line[0] === '[' && substr($line, -1) === ']') { $cur = trim(substr($line, 1, -1)); continue; }
            $pos = strcspn($line, ",\t");
            if ($pos > 0 && $pos < strlen($line) && in_array(li_normalize_type(substr($line, 0, $pos)), LIST_TYPES, true)) {
                $pairs[] = [substr($line, 0, $pos), trim(trim(substr($line, $pos + 1)), '"')];
            } elseif ($cur !== '') $pairs[] = [$cur, trim($line, '"')];
        }
    }
    $added = 0; $skipped = 0;
    db()->beginTransaction();
    try {
        foreach ($pairs as [$t, $n]) {
            $type = li_normalize_type((string)$t);
            if (!in_array($type, LIST_TYPES, true) || trim($n) === '') { $skipped++; continue; }
            if (li_add($uid, $type, $n)) $added++; else $skipped++;
        }
        db()->commit();
    } catch (Throwable $e) { db()->rollBack(); throw $e; }
    return ['added' => $added, 'skipped' => $skipped];
}
