<?php
$js = ['vendor/qrcode.js', 'js/core.js', 'js/rich.js', 'js/ui.js', 'js/render.js', 'js/app.js', 'js/screens_auth.js', 'js/screens_patients.js', 'js/screens_rx.js', 'js/screens_settings.js', 'js/screens_lists.js', 'js/pagesetup.js', 'js/admin.js'];
$v = fn($f) => 'assets/' . $f . '?v=' . @filemtime(__DIR__ . '/assets/' . $f);
header('Cache-Control: no-cache');
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#006a6a">
<title>WebRxPad</title>
<link rel="stylesheet" href="<?= $v('style.css') ?>">
</head>
<body>
<div id="app"></div>
<div id="print-root"></div>
<?php foreach ($js as $f): ?><script src="<?= $v($f) ?>"></script>
<?php endforeach; ?>
</body>
</html>
