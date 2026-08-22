<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use RuntimeException;

final class Mailer
{
    /**
     * @param list<array{name:string,mime:string,content:string}> $attachments
     */
    public function send(string $to, string $subject, string $text, array $attachments = []): void
    {
        if (filter_var($to, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('Invalid recipient email.');
        }

        $raw = $this->buildMessage($to, $subject, $text, $attachments);
        $transport = strtolower((string) Config::get('MAIL_TRANSPORT', 'log'));
        match ($transport) {
            'smtp' => $this->sendSmtp($to, $raw),
            'mail' => $this->sendPhpMail($to, $subject, $raw),
            'log' => $this->suppressToLog($raw),
            default => throw new RuntimeException('Unsupported MAIL_TRANSPORT value.'),
        };
    }

    /** @param list<array{name:string,mime:string,content:string}> $attachments */
    private function buildMessage(string $to, string $subject, string $text, array $attachments): string
    {
        $fromAddress = $this->cleanHeader((string) Config::get('MAIL_FROM_ADDRESS', 'crm@example.com'));
        $fromName = $this->encodeHeader($this->cleanHeader((string) Config::get('MAIL_FROM_NAME', 'Client Data CRM')));
        $encodedSubject = $this->encodeHeader($this->cleanHeader($subject));
        $headers = [
            'Date: ' . date(DATE_RFC2822),
            'From: ' . $fromName . ' <' . $fromAddress . '>',
            'To: <' . $to . '>',
            'Subject: ' . $encodedSubject,
            'MIME-Version: 1.0',
            'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . (parse_url((string) Config::get('APP_URL', 'https://crm.local'), PHP_URL_HOST) ?: 'crm.local') . '>',
        ];

        if ($attachments === []) {
            $headers[] = 'Content-Type: text/plain; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: quoted-printable';
            return implode("\r\n", $headers) . "\r\n\r\n" . quoted_printable_encode($text) . "\r\n";
        }

        $boundary = 'crm_' . bin2hex(random_bytes(12));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';
        $body = '--' . $boundary . "\r\n";
        $body .= "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n";
        $body .= quoted_printable_encode($text) . "\r\n";
        foreach ($attachments as $attachment) {
            $name = rawurlencode($attachment['name']);
            $body .= '--' . $boundary . "\r\n";
            $body .= 'Content-Type: ' . $attachment['mime'] . "; name*=UTF-8''{$name}\r\n";
            $body .= "Content-Transfer-Encoding: base64\r\n";
            $body .= "Content-Disposition: attachment; filename*=UTF-8''{$name}\r\n\r\n";
            $body .= chunk_split(base64_encode($attachment['content']), 76, "\r\n");
        }
        $body .= '--' . $boundary . "--\r\n";
        return implode("\r\n", $headers) . "\r\n\r\n" . $body;
    }

    private function sendPhpMail(string $to, string $subject, string $raw): void
    {
        [$headerBlock, $body] = explode("\r\n\r\n", $raw, 2);
        $headers = array_values(array_filter(
            explode("\r\n", $headerBlock),
            static fn (string $line): bool => !str_starts_with($line, 'To:') && !str_starts_with($line, 'Subject:')
        ));
        if (!mail($to, $this->encodeHeader($subject), $body, implode("\r\n", $headers))) {
            throw new RuntimeException('PHP mail() rejected the message.');
        }
    }

    private function sendSmtp(string $to, string $raw): void
    {
        $host = (string) Config::get('SMTP_HOST', '');
        $port = Config::int('SMTP_PORT', 587);
        $encryption = strtolower((string) Config::get('SMTP_ENCRYPTION', 'tls'));
        $remote = ($encryption === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $socket = @stream_socket_client($remote, $errno, $error, 15, STREAM_CLIENT_CONNECT);
        if (!is_resource($socket)) {
            throw new RuntimeException("SMTP connection failed: {$error} ({$errno}).");
        }
        stream_set_timeout($socket, 15);
        try {
            $this->expect($socket, [220]);
            $helo = parse_url((string) Config::get('APP_URL', 'https://crm.local'), PHP_URL_HOST) ?: 'crm.local';
            $this->command($socket, 'EHLO ' . $helo, [250]);
            if ($encryption === 'tls') {
                $this->command($socket, 'STARTTLS', [220]);
                if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('SMTP STARTTLS failed.');
                }
                $this->command($socket, 'EHLO ' . $helo, [250]);
            }
            $username = (string) Config::get('SMTP_USERNAME', '');
            if ($username !== '') {
                $this->command($socket, 'AUTH LOGIN', [334]);
                $this->command($socket, base64_encode($username), [334]);
                $this->command($socket, base64_encode((string) Config::get('SMTP_PASSWORD', '')), [235]);
            }
            $from = (string) Config::get('MAIL_FROM_ADDRESS', 'crm@example.com');
            $this->command($socket, 'MAIL FROM:<' . $from . '>', [250]);
            $this->command($socket, 'RCPT TO:<' . $to . '>', [250, 251]);
            $this->command($socket, 'DATA', [354]);
            $data = preg_replace('/^\./m', '..', $raw) . "\r\n.";
            $this->command($socket, $data, [250]);
            $this->command($socket, 'QUIT', [221]);
        } finally {
            fclose($socket);
        }
    }

    /** @param resource $socket @param list<int> $codes */
    private function command($socket, string $command, array $codes): void
    {
        fwrite($socket, $command . "\r\n");
        $this->expect($socket, $codes);
    }

    /** @param resource $socket @param list<int> $codes */
    private function expect($socket, array $codes): void
    {
        $response = '';
        while (($line = fgets($socket, 1024)) !== false) {
            $response .= $line;
            if (strlen($line) >= 4 && $line[3] === ' ') {
                break;
            }
        }
        $code = (int) substr($response, 0, 3);
        if (!in_array($code, $codes, true)) {
            throw new RuntimeException('SMTP error: ' . trim($response));
        }
    }

    private function suppressToLog(string $raw): never
    {
        $directory = Config::root('storage/logs');
        if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create mail log directory.');
        }
        $record = sprintf(
            "\n==== %s ====\nMail delivery suppressed in log transport; bytes=%d; digest=%s\n",
            date(DATE_ATOM),
            strlen($raw),
            hash('sha256', $raw)
        );
        if (file_put_contents($directory . '/mail.log', $record, FILE_APPEND | LOCK_EX) === false) {
            throw new RuntimeException('Unable to write the suppressed mail record.');
        }

        throw new RuntimeException('Mail delivery is suppressed by MAIL_TRANSPORT=log.');
    }

    private function cleanHeader(string $value): string
    {
        return str_replace(["\r", "\n"], '', $value);
    }

    private function encodeHeader(string $value): string
    {
        return '=?UTF-8?B?' . base64_encode($value) . '?=';
    }
}

