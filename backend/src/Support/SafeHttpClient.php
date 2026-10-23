<?php

declare(strict_types=1);

namespace CRM\Support;

use CRM\Http\ApiException;

/**
 * Outbound HTTP for URLs that come from user input (scanned business cards).
 *
 * Guards against server-side request forgery: only http/https on ports 80
 * and 443, no credentials in the URL, every resolved address must be public,
 * the connection is pinned to the checked address (no DNS rebinding),
 * redirects are followed manually and re-checked, and responses are capped
 * by size, time, and content type.
 */
final class SafeHttpClient
{
    private const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

    public function __construct(
        private readonly int $timeoutSeconds = 8,
        private readonly int $maxRedirects = 3
    ) {
    }

    /**
     * @param list<string> $acceptedTypes MIME type prefixes, e.g. ["text/html"] or ["image/"]
     * @return array{url: string, status: int, content_type: string, body: string}
     */
    public function get(string $url, int $maxBytes, array $acceptedTypes): array
    {
        if (!function_exists('curl_init')) {
            throw new ApiException(503, 'lookup_unavailable', 'На сервере не установлено расширение PHP curl.');
        }

        for ($redirects = 0; ; $redirects++) {
            [$host, $port, $address] = $this->publicTarget($url);
            $response = $this->request($url, $host, $port, $address, $maxBytes, $acceptedTypes);
            if (!in_array($response['status'], self::REDIRECT_STATUSES, true) || $response['location'] === '') {
                unset($response['location']);
                return $response;
            }
            if ($redirects >= $this->maxRedirects) {
                throw new ApiException(502, 'lookup_too_many_redirects', 'Сайт перенаправляет запрос слишком много раз.');
            }
            $url = self::absoluteUrl($response['location'], $url);
        }
    }

    /** Resolves a link found on a page against that page's URL. */
    public static function absoluteUrl(string $link, string $base): string
    {
        $link = trim(html_entity_decode($link, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $link) === 1) {
            return $link;
        }
        $parts = parse_url($base);
        $origin = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '') . (isset($parts['port']) ? ':' . $parts['port'] : '');
        if (str_starts_with($link, '//')) {
            return ($parts['scheme'] ?? 'https') . ':' . $link;
        }
        if (str_starts_with($link, '/')) {
            return $origin . $link;
        }
        $path = $parts['path'] ?? '/';
        $directory = substr($path, 0, (int) strrpos($path, '/') + 1) ?: '/';
        $segments = [];
        foreach (explode('/', $directory . $link) as $segment) {
            if ($segment === '..') {
                array_pop($segments);
            } elseif ($segment !== '.') {
                $segments[] = $segment;
            }
        }
        return $origin . '/' . ltrim(implode('/', $segments), '/');
    }

    /** @return array{0: string, 1: int, 2: string} host, port, pinned public IP */
    private function publicTarget(string $url): array
    {
        $parts = parse_url($url);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower(rtrim((string) ($parts['host'] ?? ''), '.'));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parts['user']) || isset($parts['pass'])) {
            throw new ApiException(422, 'lookup_invalid_url', 'Укажите адрес сайта в формате example.com.');
        }
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));
        if (!in_array($port, [80, 443], true)) {
            throw new ApiException(422, 'lookup_blocked_address', 'Разрешены только стандартные веб-порты 80 и 443.');
        }
        $host = trim($host, '[]');
        if ($host === 'localhost' || preg_match('/\.(?:localhost|local|internal|lan|home|corp|intranet)$/', $host) === 1) {
            throw new ApiException(422, 'lookup_blocked_address', 'Адрес указывает на внутреннюю сеть.');
        }

        $addresses = filter_var($host, FILTER_VALIDATE_IP) !== false ? [$host] : $this->resolve($host);
        if ($addresses === []) {
            throw new ApiException(502, 'lookup_unreachable', 'Домен сайта не найден.');
        }
        // Every address must be public: a mixed answer could still reach the internal network.
        foreach ($addresses as $address) {
            if (!self::isPublicIp($address)) {
                throw new ApiException(422, 'lookup_blocked_address', 'Адрес указывает на внутреннюю сеть.');
            }
        }
        $ipv4 = array_values(array_filter($addresses, static fn (string $address): bool => str_contains($address, '.')));
        return [$host, $port, $ipv4[0] ?? $addresses[0]];
    }

    /** @return list<string> */
    private function resolve(string $host): array
    {
        $ascii = function_exists('idn_to_ascii') ? (idn_to_ascii($host, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46) ?: $host) : $host;
        if (preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/', $ascii) !== 1) {
            throw new ApiException(422, 'lookup_invalid_url', 'Укажите адрес сайта в формате example.com.');
        }
        $addresses = gethostbynamel($host) ?: [];
        $records = @dns_get_record($host, DNS_AAAA) ?: [];
        foreach ($records as $record) {
            if (isset($record['ipv6'])) {
                $addresses[] = (string) $record['ipv6'];
            }
        }
        return array_values(array_unique($addresses));
    }

    public static function isPublicIp(string $address): bool
    {
        $flags = defined('FILTER_FLAG_GLOBAL_RANGE')
            ? FILTER_FLAG_GLOBAL_RANGE
            : FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
        if (filter_var($address, FILTER_VALIDATE_IP, $flags) === false) {
            return false;
        }
        $packed = @inet_pton($address);
        if ($packed === false) {
            return false;
        }
        if (strlen($packed) === 4) {
            // Carrier-grade NAT and benchmark ranges are not covered by older PHP flags.
            $long = (int) sprintf('%u', ip2long($address));
            return !(($long & 0xFFC00000) === 0x64400000 || ($long & 0xFFFE0000) === 0xC6120000);
        }
        // IPv4-mapped/compatible IPv6 (::ffff:127.0.0.1) would bypass the IPv4 checks.
        return !str_starts_with($packed, str_repeat("\0", 10) . "\xff\xff") && !str_starts_with($packed, str_repeat("\0", 12));
    }

    /**
     * @param list<string> $acceptedTypes
     * @return array{url: string, status: int, content_type: string, body: string, location: string}
     */
    private function request(string $url, string $host, int $port, string $address, int $maxBytes, array $acceptedTypes): array
    {
        $body = '';
        $tooLarge = false;
        $status = 0;
        $contentType = '';
        $location = '';
        $curl = curl_init($url);
        if ($curl === false) {
            throw new ApiException(503, 'lookup_unavailable', 'Не удалось подготовить запрос к сайту.');
        }
        $options = [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => min(5, $this->timeoutSeconds),
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            // Connect only to the address that passed the public-IP check.
            CURLOPT_RESOLVE => [sprintf('%s:%d:%s', $host, $port, str_contains($address, ':') ? '[' . $address . ']' : $address)],
            CURLOPT_PROXY => '',
            CURLOPT_NOPROXY => '*',
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_ENCODING => '',
            CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; ClientDataCRM company lookup)',
            CURLOPT_HTTPHEADER => ['Accept: ' . (in_array('text/html', $acceptedTypes, true) ? 'text/html,application/xhtml+xml;q=0.9' : 'image/*'), 'Accept-Language: en;q=1, *;q=0.5'],
            CURLOPT_HEADERFUNCTION => static function ($handle, string $header) use (&$status, &$contentType, &$location): int {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $match) === 1) {
                    [$status, $contentType, $location] = [(int) $match[1], '', ''];
                } elseif (stripos($header, 'content-type:') === 0) {
                    $contentType = strtolower(trim(explode(';', substr($header, 13))[0]));
                } elseif (stripos($header, 'location:') === 0) {
                    $location = trim(substr($header, 9));
                }
                return strlen($header);
            },
            // The limit applies to decompressed data, so compression bombs stop early too.
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$tooLarge, $maxBytes): int {
                if (strlen($body) + strlen($chunk) > $maxBytes) {
                    $tooLarge = true;
                    return 0;
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ];
        if (defined('CURLSSLOPT_NATIVE_CA')) {
            // Use the operating system's certificate store (Windows has no CA bundle configured by default).
            $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
        }
        curl_setopt_array($curl, $options);
        $completed = curl_exec($curl);
        $error = curl_error($curl);
        curl_close($curl);

        if ($tooLarge) {
            throw new ApiException(502, 'lookup_response_too_large', 'Ответ сайта слишком большой.');
        }
        if ($completed === false) {
            throw new ApiException(502, 'lookup_unreachable', 'Сайт недоступен: ' . ($error !== '' ? $error : 'нет ответа') . '.');
        }
        if (!in_array($status, self::REDIRECT_STATUSES, true)) {
            if ($status < 200 || $status >= 300) {
                throw new ApiException(502, 'lookup_http_error', "Сайт ответил с кодом {$status}.");
            }
            $accepted = false;
            foreach ($acceptedTypes as $type) {
                $accepted = $accepted || str_starts_with($contentType, $type);
            }
            if (!$accepted) {
                throw new ApiException(502, 'lookup_unexpected_content', 'Сайт вернул данные неожиданного типа.');
            }
        }

        return ['url' => $url, 'status' => $status, 'content_type' => $contentType, 'body' => $body, 'location' => $location];
    }
}
