<?php
declare(strict_types=1);

/** Small SMTP client (SSL / STARTTLS / none, AUTH LOGIN/PLAIN, one PDF attachment). No external library needed. */
final class Smtp {
    /** @var resource|null */
    private $fp = null;

    private function read(): string {
        $data = '';
        while (($line = fgets($this->fp, 2048)) !== false) {
            $data .= $line;
            if (strlen($line) < 4 || $line[3] === ' ') break;
        }
        if ($data === '') throw new RuntimeException('No answer from the mail server (timeout)');
        return $data;
    }
    private function cmd(string $c, array $ok): string {
        fwrite($this->fp, $c . "\r\n");
        $r = $this->read();
        if (!in_array((int)substr($r, 0, 3), $ok, true)) throw new RuntimeException('SMTP: ' . trim($r));
        return $r;
    }
    private static function enc(string $s): string { return '=?UTF-8?B?' . base64_encode($s) . '?='; }
    private static function addr(string $email, string $name = ''): string {
        return $name !== '' ? self::enc($name) . " <$email>" : $email;
    }

    public static function send(array $cfg, array $to, string $subject, string $body, ?string $attName = null, ?string $attData = null): void {
        $host = trim((string)($cfg['host'] ?? ''));
        $from = trim((string)($cfg['from'] ?? ''));
        if ($host === '' || $from === '') throw new RuntimeException('E-mail server is not configured (Settings → E-mail server)');
        if (!$to) throw new RuntimeException('No recipient selected');
        $port = (int)($cfg['port'] ?? 465);
        $sec = strtoupper((string)($cfg['security'] ?? 'SSL'));
        $m = new self();
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true]]);
        $remote = ($sec === 'SSL' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $m->fp = @stream_socket_client($remote, $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $ctx);
        if (!$m->fp) throw new RuntimeException("Cannot connect to $host:$port ($errstr)");
        stream_set_timeout($m->fp, 30);
        try {
            $r = $m->read();
            if ((int)substr($r, 0, 3) !== 220) throw new RuntimeException('SMTP: ' . trim($r));
            $me = $_SERVER['SERVER_NAME'] ?? 'localhost';
            $m->cmd('EHLO ' . $me, [250]);
            if ($sec === 'STARTTLS') {
                $m->cmd('STARTTLS', [220]);
                if (!stream_socket_enable_crypto($m->fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('STARTTLS failed');
                $m->cmd('EHLO ' . $me, [250]);
            }
            $user = (string)($cfg['username'] ?? '');
            if ($user !== '') {
                $r = $m->cmd('AUTH LOGIN', [334, 235, 503]);
                if ((int)substr($r, 0, 3) === 334) {
                    $m->cmd(base64_encode($user), [334]);
                    $m->cmd(base64_encode((string)($cfg['password'] ?? '')), [235]);
                }
            }
            $m->cmd('MAIL FROM:<' . $from . '>', [250]);
            foreach ($to as $t) $m->cmd('RCPT TO:<' . $t . '>', [250, 251]);
            $m->cmd('DATA', [354]);

            $bnd = '=_wrx_' . bin2hex(random_bytes(10));
            $h = [];
            $h[] = 'Date: ' . date('r');
            $h[] = 'From: ' . self::addr($from, (string)($cfg['from_name'] ?? ''));
            $h[] = 'To: ' . implode(', ', $to);
            $h[] = 'Subject: ' . self::enc($subject);
            $h[] = 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $me . '>';
            $h[] = 'MIME-Version: 1.0';
            $msg = '';
            if ($attData !== null && $attName !== null) {
                $h[] = 'Content-Type: multipart/mixed; boundary="' . $bnd . '"';
                $msg .= '--' . $bnd . "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n";
                $msg .= chunk_split(base64_encode($body)) . "\r\n";
                $msg .= '--' . $bnd . "\r\nContent-Type: application/pdf; name=\"" . $attName . "\"\r\nContent-Transfer-Encoding: base64\r\n";
                $msg .= 'Content-Disposition: attachment; filename="' . $attName . "\"\r\n\r\n";
                $msg .= chunk_split(base64_encode($attData)) . "\r\n--" . $bnd . "--\r\n";
            } else {
                $h[] = 'Content-Type: text/plain; charset=UTF-8';
                $h[] = 'Content-Transfer-Encoding: base64';
                $msg = chunk_split(base64_encode($body));
            }
            $data = implode("\r\n", $h) . "\r\n\r\n" . $msg;
            $data = preg_replace('/^\./m', '..', str_replace("\r\n", "\n", $data));
            $data = str_replace("\n", "\r\n", $data);
            fwrite($m->fp, $data . "\r\n.\r\n");
            $r = $m->read();
            if ((int)substr($r, 0, 3) !== 250) throw new RuntimeException('SMTP: ' . trim($r));
            @fwrite($m->fp, "QUIT\r\n");
        } finally {
            if (is_resource($m->fp)) fclose($m->fp);
        }
    }
}
