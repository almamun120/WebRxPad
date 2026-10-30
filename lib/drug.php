<?php
declare(strict_types=1);

/* Medicine engines (DIMS / MedEx). One shared pair of SQLite files managed by the admin. */

const ENGINES = ['dims', 'medex'];

function drug_file(string $engine): string { return DATA . '/drug_' . $engine . '.db'; }
function drug_exists(string $engine): bool { return is_file(drug_file($engine)) && filesize(drug_file($engine)) > 0; }
function drug_default(): string {
    $pref = setting(0, 'drug_engine', 'dims');
    return in_array($pref, ENGINES, true) ? $pref : 'dims';
}
function drug_active(): string {
    $pref = drug_default();
    if (drug_exists($pref)) return $pref;
    foreach (ENGINES as $e) if (drug_exists($e)) return $e;
    return $pref;
}
/** Engines the admin switched on (and that have a file). Both on = both are searched. */
function drug_enabled(string $e): bool { return drug_exists($e) && setting(0, 'engine_on_' . $e, '1') === '1'; }
function drug_on(): array { return array_values(array_filter(ENGINES, 'drug_enabled')); }
function drug_open(string $engine): ?PDO {
    static $cache = [];
    if (isset($cache[$engine])) return $cache[$engine];
    if (!drug_exists($engine)) return null;
    try {
        $p = new PDO('sqlite:' . drug_file($engine), null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $p->exec('PRAGMA query_only=1');
        return $cache[$engine] = $p;
    } catch (Throwable $e) { return null; }
}
function drug_cols(PDO $p, string $table): array {
    $c = [];
    foreach ($p->query("PRAGMA table_info($table)") as $r) $c[] = $r['name'];
    return $c;
}
function drug_stats(string $engine): ?array {
    $p = drug_open($engine);
    if (!$p) return null;
    $n = function (string $t) use ($p) { try { return (int)$p->query("SELECT COUNT(*) FROM $t")->fetchColumn(); } catch (Throwable $e) { return 0; } };
    return ['engine' => $engine, 'brands' => $n('brands'), 'generics' => $n('generics'), 'size' => filesize(drug_file($engine))];
}
/** Validates an uploaded file for an engine; throws with a readable message. */
function drug_validate(string $path, string $engine): void {
    $head = file_get_contents($path, false, null, 0, 15);
    if ($head !== 'SQLite format 3') throw new RuntimeException('This file is not an SQLite database.');
    $p = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $cols = drug_cols($p, 'brands');
    if (!in_array('name', $cols) || !in_array('url', $cols))
        throw new RuntimeException("This is not a medicine database: table 'brands' (with url, name, generic ...) was not found");
    $isMedex = in_array('full_name', $cols) && in_array('dosage_administration', $cols);
    if ($engine === 'medex' && !$isMedex) throw new RuntimeException('This file is not a MedEx-engine database (use the DIMS card for it)');
    if ($engine === 'dims' && $isMedex) throw new RuntimeException('This file looks like a MedEx-engine database (use the MedEx card for it)');
}

function dcol(array $r, string $k): string {
    $v = $r[$k] ?? '';
    $v = $v === null ? '' : (string)$v;
    return $v === 'NULL' ? '' : $v;
}

const FORM_WORDS = ['oral solution', 'oral suspension', 'eye drops', 'ear drops', 'nasal drops', 'nasal spray', 'dry syrup',
    'dry suspension', 'effervescent tablet', 'tablet', 'capsule', 'syrup', 'suspension', 'injection', 'drops',
    'cream', 'ointment', 'gel', 'inhaler', 'suppository', 'sachet', 'lotion', 'solution', 'spray', 'powder',
    'infusion', 'patch', 'granules', 'lozenge', 'shampoo', 'emulsion'];
const STRENGTH_RE = '/\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|gm|g|ml|iu|%)(?:\s?\/\s?\d*(?:[.,]\d+)?\s?(?:mg|mcg|gm|g|ml|iu|%))?/iu';

function collapse_repeat(string $name): string {
    $t = array_values(array_filter(preg_split('/\s+/u', trim($name)), fn($x) => $x !== ''));
    $changed = true;
    while ($changed && count($t) > 1) {
        $changed = false;
        for ($k = intdiv(count($t), 2); $k >= 1; $k--) {
            $tail = array_slice($t, -$k);
            $prev = array_slice(array_slice($t, 0, count($t) - $k), -$k);
            if (count($tail) === $k && count($prev) === $k) {
                $same = true;
                for ($i = 0; $i < $k; $i++) if (mb_strtolower($tail[$i]) !== mb_strtolower($prev[$i])) { $same = false; break; }
                if ($same) { $t = array_slice($t, 0, count($t) - $k); $changed = true; break; }
            }
        }
    }
    return implode(' ', $t);
}

function medex_identity(array $r): array {
    $cleaned = collapse_repeat(dcol($r, 'name'));
    $form = dcol($r, 'dosage_form');
    $base = $cleaned;
    if ($form === '') {
        $low = mb_strtolower($cleaned);
        foreach (FORM_WORDS as $w) {
            if ($low === $w || str_ends_with($low, ' ' . $w)) {
                $form = mb_substr($cleaned, mb_strlen($cleaned) - mb_strlen($w));
                $base = trim(mb_substr($cleaned, 0, mb_strlen($cleaned) - mb_strlen($w)));
                break;
            }
        }
    } elseif (str_ends_with(mb_strtolower($cleaned), ' ' . mb_strtolower($form))) {
        $base = trim(mb_substr($cleaned, 0, mb_strlen($cleaned) - mb_strlen($form)));
    }
    $full = trim(dcol($r, 'full_name'));
    $name = $full !== '' ? $full : ($base !== '' ? $base : $cleaned);
    $strength = dcol($r, 'strength');
    if ($strength === '' && preg_match(STRENGTH_RE, dcol($r, 'list_text'), $m)) $strength = $m[0];
    if ($strength === '' && preg_match(STRENGTH_RE, str_replace('-', ' ', dcol($r, 'slug')), $m)) $strength = $m[0];
    return [$name, $form, trim($strength)];
}

function money(string $v): string { return trim(preg_replace('/\.0$/', '', $v)); }

function suggestion_from(array $r, string $engine): array {
    if ($engine === 'medex') {
        [$nm, $form, $strength] = medex_identity($r);
        $unit = money(dcol($r, 'unit_price')); $strip = money(dcol($r, 'strip_price'));
        $price = implode(', ', array_filter([$unit !== '' ? "Unit ৳$unit" : '', $strip !== '' ? "Strip ৳$strip" : ''], fn($x) => $x !== ''));
        $pack = dcol($r, 'package_container');
        if ($pack === '') $pack = dcol($r, 'unit_price_note');
        return ['url' => dcol($r, 'url'), 'name' => $nm, 'generic' => dcol($r, 'generic'), 'strength' => $strength, 'form' => $form,
            'company' => dcol($r, 'company'), 'pack' => $pack, 'price' => $price, 'indication' => dcol($r, 'ind_short')];
    }
    return ['url' => dcol($r, 'url'), 'name' => dcol($r, 'name'), 'generic' => dcol($r, 'generic'), 'strength' => dcol($r, 'strength'),
        'form' => dcol($r, 'dosage_form'), 'company' => dcol($r, 'company'), 'pack' => dcol($r, 'pack_size'),
        'price' => dcol($r, 'price'), 'indication' => dcol($r, 'ind_short')];
}

function like_esc(string $t): string { return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $t); }

function drug_search_one(string $engine, string $query, int $limit, bool $inIndications): array {
    $tokens = array_values(array_filter(preg_split('/\s+/u', trim($query)), fn($x) => $x !== ''));
    if (!$tokens) return [];
    $p = drug_open($engine);
    if (!$p) return [];
    $where = []; $args = [];
    foreach ($tokens as $t) {
        $parts = ["name LIKE ? ESCAPE '\\'", "generic LIKE ? ESCAPE '\\'", "company LIKE ? ESCAPE '\\'", "dosage_form LIKE ? ESCAPE '\\'"];
        if ($inIndications) $parts[] = "indications LIKE ? ESCAPE '\\'";
        $where[] = '(' . implode(' OR ', $parts) . ')';
        $like = '%' . like_esc($t) . '%';
        for ($i = 0; $i < count($parts); $i++) $args[] = $like;
    }
    $first = like_esc($tokens[0]) . '%';
    $args[] = $first; $args[] = $first;
    $cols = $engine === 'medex'
        ? 'url, slug, name, full_name, list_text, generic, strength, dosage_form, company, package_container, unit_price_note, unit_price, strip_price'
        : 'url, name, generic, strength, dosage_form, company, pack_size, price';
    $sql = "SELECT $cols, substr(indications, 1, 160) AS ind_short FROM brands WHERE " . implode(' AND ', $where) .
        " ORDER BY CASE WHEN name LIKE ? ESCAPE '\\' THEN 1 WHEN generic LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END, name LIMIT " . max(1, min(200, $limit));
    $out = [];
    try {
        $st = $p->prepare($sql); $st->execute($args);
        while ($r = $st->fetch()) { $o = suggestion_from($r, $engine); $o['engine'] = $engine; $out[] = $o; }
    } catch (Throwable $e) { }
    return $out;
}

function drug_search(string $query, int $limit = 40, bool $inIndications = true): array {
    $lists = [];
    foreach (drug_on() as $e) $lists[] = drug_search_one($e, $query, $limit, $inIndications);
    if (count($lists) <= 1) return $lists[0] ?? [];
    $out = [];   // take turns so both engines show up near the top
    for ($i = 0; count($out) < $limit; $i++) {
        $any = false;
        foreach ($lists as $l) if (isset($l[$i]) && count($out) < $limit) { $out[] = $l[$i]; $any = true; }
        if (!$any) break;
    }
    return $out;
}

/* ---------- details ---------- */

function parse_extra(string $raw): array {
    $t = trim($raw);
    if ($t === '') return [];
    $out = [];
    if ($t[0] === '{') {
        $o = json_decode($t, true);
        if (is_array($o)) {
            foreach ($o as $k => $v) {
                $text = is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : (string)$v;
                if (trim($text) !== '') $out[] = [(string)$k, $text];
            }
            return $out;
        }
    } elseif ($t[0] === '[') {
        $a = json_decode($t, true);
        if (is_array($a)) {
            foreach ($a as $o) {
                if (is_array($o) && (isset($o['title']) || isset($o['content']))) {
                    $c = (string)($o['content'] ?? '');
                    if (trim($c) !== '') $out[] = [(string)($o['title'] ?? ''), $c];
                } else {
                    $text = is_array($o) ? json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : (string)$o;
                    if (trim($text) !== '') $out[] = ['', $text];
                }
            }
            return $out;
        }
    }
    return [['', $t]];
}
function pretty_cell(string $t): string {
    $x = trim($t);
    if ($x === '' || !($x[0] === '{' || $x[0] === '[')) return $x;
    $parts = parse_extra($x);
    if (!$parts) return $x;
    return implode("\n", array_map(fn($kv) => $kv[0] === '' ? $kv[1] : $kv[0] . ': ' . $kv[1], $parts));
}
function title_of(string $col): string { return implode(' ', array_map('ucfirst', explode('_', $col))); }
function safe_url(string $u): string { return (stripos($u, 'http://') === 0 || stripos($u, 'https://') === 0) ? $u : ''; }

function render_value(string $raw): array {
    $t = trim($raw);
    if ($t === '') return [];
    if (!($t[0] === '[' || $t[0] === '{')) return [['label' => '', 'text' => $t, 'url' => '']];
    $j = json_decode($t, true);
    if (!is_array($j)) return [['label' => '', 'text' => $t, 'url' => '']];
    $out = [];
    foreach ($j as $k => $v) {
        $key = is_string($k) ? $k : null;
        if (is_array($v) && isset($v['url'])) {
            $txt = (string)($v['text'] ?? '');
            if ($txt === '') $txt = (string)$v['url'];
            $out[] = ['label' => '', 'text' => $txt, 'url' => safe_url((string)$v['url'])];
        } elseif (is_array($v)) {
            $out[] = ['label' => '', 'text' => json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'url' => ''];
        } else {
            $txt = (string)$v;
            if (trim($txt) !== '') $out[] = ['label' => $key !== null ? "$key:" : '', 'text' => $txt, 'url' => ''];
        }
    }
    return $out;
}

function drug_details(string $url, string $hint = ''): ?array {
    $first = in_array($hint, ENGINES, true) ? $hint : (drug_on()[0] ?? drug_active());
    $order = array_merge([$first], array_values(array_filter(ENGINES, fn($e) => $e !== $first)));
    foreach ($order as $e) {
        $r = $e === 'medex' ? details_medex($url) : details_dims($url);
        if ($r) return $r;
    }
    return null;
}

function item(string $text, string $label = '', string $url = ''): array { return ['label' => $label, 'text' => $text, 'url' => $url]; }

function details_dims(string $url): ?array {
    $p = drug_open('dims');
    if (!$p) return null;
    $st = $p->prepare('SELECT * FROM brands WHERE url = ?'); $st->execute([$url]);
    $b = $st->fetch();
    if (!$b) return null;
    foreach ($b as $k => $v) $b[$k] = $v === null ? '' : (string)$v;
    $sugg = suggestion_from($b + ['ind_short' => ''], 'dims');
    $g = null;
    if (trim($b['generic'] ?? '') !== '') {
        try {
            $gs = $p->prepare('SELECT * FROM generics WHERE name = ? COLLATE NOCASE LIMIT 1'); $gs->execute([$b['generic']]);
            $g = $gs->fetch() ?: null;
            if ($g) foreach ($g as $k => $v) $g[$k] = $v === null ? '' : (string)$v;
        } catch (Throwable $e) { }
    }
    $f = function (string $col) use ($b, $g): string {
        $v = trim($b[$col] ?? '');
        if ($v === '') $v = trim($g[$col] ?? '');
        return $v;
    };
    $extra = parse_extra($b['extra_sections'] ?? '');
    if (!$extra && $g) $extra = parse_extra($g['extra_sections'] ?? '');
    $pick = ['overdos' => '', 'duration' => '', 'reconstitut' => '', 'storage' => '', 'class' => ''];
    $rest = [];
    foreach ($extra as [$t, $c]) {
        $hit = false;
        foreach (array_keys($pick) as $needle) {
            if ($t !== '' && stripos($t, $needle) !== false) { $pick[$needle] .= ($pick[$needle] !== '' ? "\n" : '') . $c; $hit = true; break; }
        }
        if (!$hit) $rest[] = $t !== '' ? "$t: $c" : $c;
    }
    $dosage = $f('adult_dose');
    $renal = $f('renal_dose');
    if ($renal !== '') $dosage .= ($dosage !== '' ? "\n\n" : '') . 'Renal dose: ' . $renal;
    $ind = $f('indications');
    $sections = [];
    $add = function (string $title, string $text) use (&$sections) { if (trim($text) !== '') $sections[] = ['title' => $title, 'items' => [item($text)]]; };
    $add('Indication Description', $ind);
    $add('Therapeutic Class Description', $pick['class']);
    $add('Pharmacology Description', $f('mechanism_of_action'));
    $add('Dosage Description', $dosage);
    $add('Administration Description', $f('administration'));
    $add('Interaction Description', $f('interactions'));
    $add('Contraindications Description', $f('contra_indications'));
    $add('Side Effects Description', $f('adverse_effects'));
    $add('Pregnancy and Lactation Description', $f('pregnancy_lactation'));
    $add('Precautions Description', $f('precautions'));
    $add('Pediatric Usage Description', $f('child_dose'));
    $add('Overdose Effects Description', $pick['overdos']);
    $add('Duration of Treatment Description', $pick['duration']);
    $add('Reconstitution Description', $pick['reconstitut']);
    $add('Storage Conditions Description', $pick['storage']);
    $extraItems = [];
    foreach ($rest as $x) $extraItems[] = item($x);
    $block = function (string $label, array $items) use (&$extraItems) {
        if (!$items) return;
        $extraItems[] = item('', $label);
        foreach ($items as $i) $extraItems[] = $i;
    };
    $block('Other brands:', render_value($b['other_brands'] ?? ''));
    $price = trim($b['price'] ?? '');
    if ($price !== '') $block('Price:', [item($price)]);
    $block('Available as:', render_value($b['available_as'] ?? ''));
    if ($extraItems) $sections[] = ['title' => 'Extra Information', 'items' => $extraItems];
    $basic = [['Brand Name', $sugg['name']], ['Generic Name', $sugg['generic']], ['Strength', $sugg['strength']],
        ['Dosage Form', $sugg['form']], ['Manufacturer', $sugg['company']], ['Package', $sugg['pack']],
        ['Indication', mb_substr($ind, 0, 120)]];
    return ['suggestion' => $sugg, 'basic' => $basic, 'sections' => $sections];
}

function details_medex(string $url): ?array {
    $p = drug_open('medex');
    if (!$p) return null;
    $st = $p->prepare('SELECT * FROM brands WHERE url = ?'); $st->execute([$url]);
    $b = $st->fetch();
    if (!$b) return null;
    foreach ($b as $k => $v) $b[$k] = $v === null ? '' : (string)$v;
    $sg = suggestion_from($b + ['ind_short' => ''], 'medex');
    $g = null;
    try {
        $gid = $b['generic_id'] ?? '';
        if (trim($gid) !== '') { $gs = $p->prepare('SELECT * FROM generics WHERE id = ? LIMIT 1'); $gs->execute([$gid]); }
        else { $gs = $p->prepare('SELECT * FROM generics WHERE name = ? COLLATE NOCASE LIMIT 1'); $gs->execute([$b['generic'] ?? '']); }
        $g = $gs->fetch() ?: null;
        if ($g) foreach ($g as $k => $v) $g[$k] = $v === null ? '' : (string)$v;
    } catch (Throwable $e) { }
    $f = function (string $col) use ($b, $g): string {
        $v = trim($b[$col] ?? '');
        if ($v === 'NULL') $v = '';
        if ($v === '') $v = trim($g[$col] ?? '');
        return pretty_cell($v);
    };
    $sections = [];
    $add = function (string $title, string $text) use (&$sections) { if (trim($text) !== '') $sections[] = ['title' => $title, 'items' => [item($text)]]; };
    $ind = $f('indications');
    $add('Composition', $f('composition'));
    $add('Indication Description', $ind);
    $add('Therapeutic Class Description', $f('therapeutic_class'));
    $add('Pharmacology Description', $f('pharmacology'));
    $add('Dosage & Administration Description', $f('dosage_administration'));
    $add('Interaction Description', $f('interaction'));
    $add('Contraindications Description', $f('contraindications'));
    $add('Side Effects Description', $f('side_effects'));
    $add('Pregnancy and Lactation Description', $f('pregnancy_lactation'));
    $add('Precautions & Warnings Description', $f('precautions_warnings'));
    $add('Special Populations Description', $f('special_populations'));
    $add('Overdose Effects Description', $f('overdose_effects'));
    $add('Storage Conditions Description', $f('storage_conditions'));
    $extraItems = [];
    $extra = parse_extra($b['extra_sections'] ?? '');
    if (!$extra && $g) $extra = parse_extra($g['extra_sections'] ?? '');
    foreach ($extra as [$t, $c]) $extraItems[] = item($t !== '' ? "$t: $c" : $c);
    $priceLines = [];
    $n = trim($b['unit_price_note'] ?? ''); if ($n !== '' && $n !== 'NULL') $priceLines[] = $n;
    if ($sg['price'] !== '') $priceLines[] = $sg['price'];
    $n = trim($b['other_prices'] ?? ''); if ($n !== '' && $n !== 'NULL') $priceLines[] = pretty_cell($n);
    if ($priceLines) { $extraItems[] = item('', 'Price:'); foreach ($priceLines as $l) $extraItems[] = item($l); }
    $handled = ['id', 'url', 'slug', 'herbal', 'name', 'full_name', 'dosage_form', 'strength', 'generic', 'generic_id', 'generic_url',
        'company', 'company_id', 'company_url', 'unit_price', 'unit_price_note', 'strip_price', 'other_prices', 'package_container',
        'alt_brands_url', 'bn_url', 'list_text', 'composition', 'indications', 'pharmacology', 'dosage_administration',
        'interaction', 'contraindications', 'side_effects', 'pregnancy_lactation', 'precautions_warnings', 'special_populations',
        'overdose_effects', 'therapeutic_class', 'storage_conditions', 'extra_sections'];
    foreach ($b as $k => $v) {
        if (in_array($k, $handled, true)) continue;
        $t = pretty_cell($v);
        if (trim($t) !== '' && $t !== 'NULL' && stripos($t, 'http') !== 0) $extraItems[] = item(title_of($k) . ': ' . $t);
    }
    if ($g) {
        $bc = trim($g['brand_count'] ?? '');
        if ($bc !== '' && $bc !== 'NULL') $extraItems[] = item("Available brands of this generic: $bc");
    }
    if (($b['herbal'] ?? '0') === '1') $extraItems[] = item('Herbal product');
    $links = [];
    $link = function (string $text, string $key) use ($b, &$links) { $u = safe_url($b[$key] ?? ''); if ($u !== '') $links[] = item($text, '', $u); };
    $link('Brand page', 'url'); $link('Generic page', 'generic_url'); $link('Company page', 'company_url');
    $link('Alternative brands', 'alt_brands_url'); $link('Bangla page', 'bn_url');
    if ($g) { $u = safe_url($g['brand_names_url'] ?? ''); if ($u !== '') $links[] = item('All brands of this generic', '', $u); }
    if ($links) { $extraItems[] = item('', 'Links:'); foreach ($links as $l) $extraItems[] = $l; }
    if ($extraItems) $sections[] = ['title' => 'Extra Information', 'items' => $extraItems];
    $basic = [['Brand Name', $sg['name']], ['Generic Name', $sg['generic']], ['Strength', $sg['strength']], ['Dosage Form', $sg['form']],
        ['Manufacturer', $sg['company']], ['Package', $sg['pack']], ['Price', $sg['price']], ['Indication', mb_substr($ind, 0, 120)]];
    return ['suggestion' => $sg, 'basic' => $basic, 'sections' => $sections];
}
