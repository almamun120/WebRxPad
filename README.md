# WebRxPad
PHP 8+ (pdo_sqlite, mbstring, openssl) + SQLite. No composer.
1. Upload the folder to PHP hosting (Apache/nginx). `data/` must be writable.
2. nginx: add `location ~ ^/WebRxPad/data/ { deny all; }` (Apache uses data/.htaccess).
3. Open the site -> first run asks to create the admin account.
4. Doctors sign up; admin approves them under "Doctors".
5. Admin > Medicine engines: upload DIMS / MedEx .db files (chunked, works with small upload limits).
Doctor data: Settings > Database (own patients export/import), Settings > Suggestion lists.
Admin lists are shared read-only; doctors manage only their own entries.
