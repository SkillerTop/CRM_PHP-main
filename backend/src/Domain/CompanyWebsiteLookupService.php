<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Http\ApiException;
use CRM\Support\SafeHttpClient;
use DOMDocument;
use DOMElement;
use DOMXPath;

/**
 * Reads public company details from the company's own website: name,
 * description, postal address, and logo. Sources, in order of trust:
 * schema.org Organization JSON-LD, <meta> description tags, <address> /
 * microdata, then a contact page. Nothing is saved; the result only
 * prefills the "New company" form for review.
 */
final class CompanyWebsiteLookupService
{
    private const PAGE_MAX_BYTES = 2 * 1024 * 1024;
    private const LOGO_MAX_BYTES = 1024 * 1024;
    private const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
    private const ORGANIZATION_TYPES = ['organization', 'corporation', 'localbusiness', 'professionalservice', 'store', 'ngo', 'educationalorganization', 'governmentorganization'];
    private const CONTACT_LINK = '/(?:contact|kontakt|impressum|imprint|about|om-oss|o-nas|о-нас|контакт|про-нас|where|address|location)/iu';

    private float $deadline = 0.0;

    public function __construct(
        private readonly SafeHttpClient $http,
        private readonly int $totalSeconds = 20
    ) {
    }

    /** @return array{website: string, name: ?string, description: ?string, address: ?string, city: ?string, country: ?string, logo_data_url: ?string} */
    public function lookup(string $website): array
    {
        $this->deadline = microtime(true) + $this->totalSeconds;
        $home = $this->fetchHome($website);
        $page = $this->parse($home['body'], $home['content_type']);
        $organization = $this->organization($page);

        $name = $this->text($organization['name'] ?? null) ?? $this->meta($page, 'og:site_name') ?? $this->title($page);
        $description = $this->text($organization['description'] ?? null)
            ?? $this->meta($page, 'description')
            ?? $this->meta($page, 'og:description');

        [$address, $city, $country] = $this->postalAddress($organization['address'] ?? null);
        $address ??= $this->addressFromMarkup($page);
        if ($address === null) {
            [$address, $city] = $this->addressFromText($page, $city);
        }
        if ($address === null && $this->hasTime()) {
            [$address, $city, $country] = $this->addressFromContactPage($page, $home['url'], $city, $country);
        }

        $logo = $this->hasTime() ? $this->logo($page, $home['url'], $organization['logo'] ?? null) : null;

        if ($description === null && $address === null && $logo === null) {
            throw new ApiException(422, 'lookup_no_data', 'На сайте не найдено описание, адрес или логотип компании.');
        }

        return [
            'website' => $this->origin($home['url']),
            'name' => $name,
            'description' => $description !== null ? mb_substr($description, 0, 600) : null,
            'address' => $address,
            'city' => $city,
            'country' => $country,
            'logo_data_url' => $logo,
        ];
    }

    /** @return array{url: string, status: int, content_type: string, body: string} */
    private function fetchHome(string $website): array
    {
        $website = trim($website);
        if (!preg_match('#^https?://#i', $website)) {
            $website = 'https://' . $website;
        }
        $host = strtolower((string) parse_url($website, PHP_URL_HOST));
        if ($host === '' || !str_contains($host, '.')) {
            throw new ApiException(422, 'lookup_invalid_url', 'Укажите адрес сайта в формате example.com.');
        }
        // Card domains are bare ("conoship.com"); some sites only answer on www or plain http.
        $attempts = array_unique([
            "https://{$host}/",
            str_starts_with($host, 'www.') ? "https://{$host}/" : "https://www.{$host}/",
            "http://{$host}/",
        ]);
        $lastError = null;
        foreach ($attempts as $url) {
            if (!$this->hasTime()) {
                break;
            }
            try {
                return $this->http->get($url, self::PAGE_MAX_BYTES, ['text/html', 'application/xhtml+xml']);
            } catch (ApiException $error) {
                if (in_array($error->errorCode, ['lookup_blocked_address', 'lookup_invalid_url'], true)) {
                    throw $error;
                }
                $lastError = $error;
            }
        }
        throw $lastError ?? new ApiException(504, 'lookup_timeout', 'Сайт не ответил вовремя.');
    }

    private function parse(string $html, string $contentType): DOMXPath
    {
        $charset = '';
        if (preg_match('/<meta[^>]+charset=["\']?([\w-]+)/i', substr($html, 0, 4096), $match) === 1) {
            $charset = strtolower($match[1]);
        }
        if ($charset !== '' && $charset !== 'utf-8' && $charset !== 'utf8' && in_array(strtoupper($charset), array_map('strtoupper', mb_list_encodings()), true)) {
            $html = (string) mb_convert_encoding($html, 'UTF-8', $charset);
        } elseif (!mb_check_encoding($html, 'UTF-8')) {
            $html = (string) mb_convert_encoding($html, 'UTF-8', 'Windows-1252');
        }
        $document = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        // The XML declaration makes libxml read the page as UTF-8; LIBXML_NONET forbids network access.
        $document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        return new DOMXPath($document);
    }

    /** @return array<string, mixed> The first schema.org Organization found in JSON-LD. */
    private function organization(DOMXPath $page): array
    {
        foreach ($page->query('//script[@type="application/ld+json"]') ?: [] as $script) {
            $data = json_decode(trim($script->textContent), true);
            if (!is_array($data)) {
                continue;
            }
            $found = $this->findOrganization($data);
            if ($found !== null) {
                return $found;
            }
        }
        return [];
    }

    /** @param array<mixed> $node @return array<string, mixed>|null */
    private function findOrganization(array $node, int $depth = 0): ?array
    {
        if ($depth > 6) {
            return null;
        }
        $types = array_map('strtolower', array_map('strval', (array) ($node['@type'] ?? [])));
        if (array_intersect($types, self::ORGANIZATION_TYPES) !== []) {
            return $node;
        }
        foreach ($node as $value) {
            if (is_array($value)) {
                $found = $this->findOrganization($value, $depth + 1);
                if ($found !== null) {
                    return $found;
                }
            }
        }
        return null;
    }

    /** @return array{0: ?string, 1: ?string, 2: ?string} address, city, country */
    private function postalAddress(mixed $address): array
    {
        if (is_array($address) && array_is_list($address)) {
            $address = $address[0] ?? null;
        }
        if (is_string($address)) {
            return [$this->text($address), null, null];
        }
        if (!is_array($address)) {
            return [null, null, null];
        }
        $country = $address['addressCountry'] ?? null;
        $country = is_array($country) ? ($country['name'] ?? null) : $country;
        $city = $this->text($address['addressLocality'] ?? null);
        $parts = array_filter([
            $this->text($address['streetAddress'] ?? null),
            trim(($this->text($address['postalCode'] ?? null) ?? '') . ' ' . ($city ?? '')),
            $this->text($address['addressRegion'] ?? null),
            $this->text($country),
        ]);
        return [$parts !== [] ? implode(', ', $parts) : null, $city, $this->text($country)];
    }

    private function addressFromMarkup(DOMXPath $page): ?string
    {
        foreach (['//*[@itemprop="address"]', '//address', '//footer//*[contains(@class, "address")]'] as $query) {
            foreach ($page->query($query) ?: [] as $node) {
                $text = $this->text(preg_replace('/\s*\n\s*/u', ', ', $node->textContent) ?? '');
                if ($text !== null && mb_strlen($text) <= 200 && preg_match('/\d/', $text) === 1 && preg_match('/@|https?:/i', $text) !== 1) {
                    return $text;
                }
            }
        }
        return null;
    }

    /**
     * Plain-text addresses ("Main office · Leonard Springerlaan 7, 9727 KB, Groningen"):
     * a short line with a postal code, preferably right after an office label,
     * joined with the street line above it when the postal line has no street.
     *
     * @return array{0: ?string, 1: ?string} address, city
     */
    private function addressFromText(DOMXPath $page, ?string $city): array
    {
        $html = $page->document->saveHTML() ?: '';
        $html = preg_replace('#<(script|style|svg|noscript|head)[^>]*>.*?</\1>#is', '', $html) ?? $html;
        $html = preg_replace('#<(?:br|/p|/div|/li|/h\d|/td|/tr|/span|/a|/address|/strong|/b)[^>]*>#i', "\n", $html) ?? $html;
        $lines = array_values(array_filter(array_map(
            fn (string $line): string => $this->text($line) ?? '',
            explode("\n", strip_tags($html))
        )));

        $postal = '/(?<![\d+])(?:\d{4}\s?[A-Z]{2}|\d{2}-\d{3}|\d{3}\s\d{2}|\d{5}|(?!19\d\d|20\d\d)\d{4})(?![\d-])/u';
        $streetLike = static fn (string $line): bool => mb_strlen($line) <= 80
            && preg_match('/\p{L}{3,}\.?\s+\d{1,4}\p{L}?\b/u', $line) === 1
            && preg_match('/@|https?:|\+\d|©/u', $line) !== 1;
        $best = null;
        foreach ($lines as $index => $line) {
            if (mb_strlen($line) > 120 || preg_match('/@|https?:|©|\+\d|\(\d/u', $line) === 1
                || preg_match_all('/\d/', $line) > 12 || preg_match_all('/\p{L}/u', $line) < 3
                || preg_match($postal, $line, $match) !== 1) {
                continue;
            }
            $labelled = preg_match('/(?:main|head|registered)\s+office|headquarters|\bhq\b|address|adres|adresse|anschrift|siedziba|biuro|адрес|адреса|офіс|офис|kontor|besøksadresse|postadresse/iu', implode(' ', array_slice($lines, max(0, $index - 2), 2))) === 1;
            $address = $line;
            if (!$streetLike($line) && $index > 0 && $streetLike($lines[$index - 1])) {
                $address = rtrim($lines[$index - 1], ' ,') . ', ' . $line;
            }
            if (!$streetLike($address)) {
                continue;
            }
            $candidate = [trim($address, ' ,'), $city ?? $this->cityAfterPostal($line, $match[0])];
            if ($labelled) {
                return $candidate;
            }
            $best ??= $candidate;
        }
        return $best ?? [null, $city];
    }

    private function cityAfterPostal(string $line, string $postalCode): ?string
    {
        $after = trim(substr($line, (int) strpos($line, $postalCode) + strlen($postalCode)), " ,");
        return preg_match('/^(\p{L}[\p{L}\s\'-]{1,40}?)(?:,|$)/u', $after, $match) === 1 ? trim($match[1]) : null;
    }

    /** @return array{0: ?string, 1: ?string, 2: ?string} */
    private function addressFromContactPage(DOMXPath $page, string $baseUrl, ?string $city, ?string $country): array
    {
        $origin = $this->origin($baseUrl);
        foreach ($page->query('//a[@href]') ?: [] as $link) {
            if (!$link instanceof DOMElement) {
                continue;
            }
            $href = $link->getAttribute('href');
            if (preg_match(self::CONTACT_LINK, $href . ' ' . $link->textContent) !== 1) {
                continue;
            }
            $url = SafeHttpClient::absoluteUrl($href, $baseUrl);
            // Stay on the company's own site.
            if ($this->origin($url) !== $origin && $this->registrableHost($url) !== $this->registrableHost($baseUrl)) {
                continue;
            }
            try {
                $contact = $this->http->get($url, self::PAGE_MAX_BYTES, ['text/html', 'application/xhtml+xml']);
            } catch (ApiException) {
                return [null, $city, $country];
            }
            $contactPage = $this->parse($contact['body'], $contact['content_type']);
            [$address, $foundCity, $foundCountry] = $this->postalAddress($this->organization($contactPage)['address'] ?? null);
            $address ??= $this->addressFromMarkup($contactPage);
            if ($address === null) {
                [$address, $foundCity] = $this->addressFromText($contactPage, $foundCity);
            }
            return [$address, $foundCity ?? $city, $foundCountry ?? $country];
        }
        return [null, $city, $country];
    }

    private function logo(DOMXPath $page, string $baseUrl, mixed $structuredLogo): ?string
    {
        $candidates = [];
        $structuredLogo = is_array($structuredLogo) ? ($structuredLogo['url'] ?? $structuredLogo['contentUrl'] ?? null) : $structuredLogo;
        if (is_string($structuredLogo) && $structuredLogo !== '') {
            $candidates[] = $structuredLogo;
        }
        foreach ($page->query('(//header//img | //nav//img | //img)[contains(translate(concat(@src, " ", @alt, " ", @class, " ", @id), "LOGO", "logo"), "logo")]') ?: [] as $image) {
            $source = $image instanceof DOMElement ? ($image->getAttribute('src') ?: $image->getAttribute('data-src')) : '';
            // White/negative variants are made for dark headers and vanish on the CRM's white background.
            if ($source !== '' && !str_starts_with($source, 'data:') && preg_match('/white|negative|inverse|invert|[-_]light\b|[-_]wit\b/i', $source) !== 1) {
                $candidates[] = $source;
            }
        }
        $icons = [];
        foreach ($page->query('//link[@href and (contains(@rel, "apple-touch-icon") or contains(@rel, "icon"))]') ?: [] as $icon) {
            if ($icon instanceof DOMElement) {
                $size = (int) (preg_match('/(\d+)x\d+/', $icon->getAttribute('sizes'), $match) === 1 ? $match[1] : (str_contains($icon->getAttribute('rel'), 'apple') ? 180 : 32));
                if (str_contains($icon->getAttribute('href'), '.svg') || str_contains($icon->getAttribute('type'), 'svg')) {
                    $size = 512;
                }
                $icons[$icon->getAttribute('href')] = $size;
            }
        }
        // Largest icons first; small or unsized ones are still tried (the download checks the real size).
        arsort($icons);
        foreach (array_keys($icons) as $href) {
            $candidates[] = (string) $href;
        }
        $candidates[] = '/favicon.ico';

        $attempts = 0;
        foreach (array_unique(array_map(static fn (string $link): string => SafeHttpClient::absoluteUrl($link, $baseUrl), $candidates)) as $url) {
            if (++$attempts > 4 || !$this->hasTime()) {
                break;
            }
            try {
                $image = $this->http->get($url, self::LOGO_MAX_BYTES, ['image/', 'application/octet-stream']);
            } catch (ApiException) {
                continue;
            }
            $dataUrl = $this->imageDataUrl($image['body']);
            if ($dataUrl !== null) {
                return $dataUrl;
            }
        }
        return null;
    }

    /** Verifies the bytes really are an image of a usable size; the browser converts it to WebP. */
    private function imageDataUrl(string $bytes): ?string
    {
        if ($bytes === '') {
            return null;
        }
        $type = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes) ?: '';
        if ($type === 'image/svg+xml' || ($type === 'text/xml' || $type === 'text/plain') && preg_match('/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--.*?-->\s*)*<svg[\s>]/is', $bytes) === 1) {
            return 'data:image/svg+xml;base64,' . base64_encode($bytes);
        }
        if (!in_array($type, self::LOGO_TYPES, true)) {
            return null;
        }
        $size = @getimagesizefromstring($bytes);
        if ($size === false || max($size[0], $size[1]) < 32) {
            return null;
        }
        return 'data:' . $type . ';base64,' . base64_encode($bytes);
    }

    private function meta(DOMXPath $page, string $name): ?string
    {
        foreach ($page->query(sprintf('//meta[@name="%1$s" or @property="%1$s"]/@content', $name)) ?: [] as $content) {
            $text = $this->text($content->nodeValue);
            if ($text !== null) {
                return $text;
            }
        }
        return null;
    }

    private function title(DOMXPath $page): ?string
    {
        $title = $this->text($page->query('//title')?->item(0)?->textContent);
        return $title !== null ? trim(preg_split('/\s+[|–—-]\s+/u', $title)[0] ?? $title) : null;
    }

    private function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
        return $value !== '' ? $value : null;
    }

    private function origin(string $url): string
    {
        $parts = parse_url($url);
        return strtolower(($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? ''));
    }

    private function registrableHost(string $url): string
    {
        return preg_replace('/^www\./', '', strtolower((string) parse_url($url, PHP_URL_HOST))) ?? '';
    }

    private function hasTime(): bool
    {
        return microtime(true) < $this->deadline;
    }
}
