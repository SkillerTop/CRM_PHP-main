<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use CRM\Http\ApiException;

final class TranslationService
{
    private const MAX_RESPONSE_BYTES = 262144;
    private const MAX_CHUNK_CHARACTERS = 450;

    public function toEnglish(string $text): string
    {
        $text = trim($text);
        if ($text === '') {
            throw new ApiException(422, 'translation_text_required', 'Введите текст для перевода.');
        }
        if (mb_strlen($text) > 10000) {
            throw new ApiException(422, 'translation_text_too_long', 'Текст для перевода не должен превышать 10 000 символов.');
        }

        $parts = preg_split('/(\R+)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) ?: [$text];
        $translated = '';
        foreach ($parts as $part) {
            if (preg_match('/^\R+$/u', $part) === 1) {
                $translated .= $part;
                continue;
            }
            $translatedChunks = [];
            foreach ($this->chunks(trim($part)) as $chunk) {
                $translatedChunks[] = $this->translateChunk($chunk);
            }
            $translated .= implode(' ', $translatedChunks);
        }
        $translated = trim($translated);
        if ($translated === '') {
            throw new ApiException(502, 'translation_empty_response', 'Сервис перевода не вернул текст.');
        }
        return $translated;
    }

    private function translateChunk(string $text): string
    {
        $endpoint = rtrim((string) Config::get('TRANSLATION_ENDPOINT', 'https://api.mymemory.translated.net/get'), '?');
        $url = $endpoint . '?' . http_build_query([
            'q' => $text,
            'langpair' => 'Autodetect|en',
        ], '', '&', PHP_QUERY_RFC3986);
        [$response, $status, $error, $tooLarge] = $this->request($url);
        if ($tooLarge || $status < 200 || $status >= 300) {
            throw new ApiException(502, 'translation_failed', 'Не удалось перевести текст. Повторите попытку.', [
                'provider_status' => $status,
                'provider_error' => $tooLarge ? 'response_too_large' : substr($error, 0, 160),
            ]);
        }
        $payload = json_decode($response, true);
        $translated = is_array($payload) && isset($payload['responseData']['translatedText'])
            ? trim(html_entity_decode((string) $payload['responseData']['translatedText'], ENT_QUOTES | ENT_HTML5, 'UTF-8'))
            : '';
        if ($translated === '' || (isset($payload['responseStatus']) && (int) $payload['responseStatus'] !== 200)) {
            throw new ApiException(502, 'translation_invalid_response', 'Сервис перевода вернул некорректный ответ.');
        }
        return $translated;
    }

    /** @return list<string> */
    private function chunks(string $text): array
    {
        if (mb_strlen($text) <= self::MAX_CHUNK_CHARACTERS) {
            return [$text];
        }
        $tokens = preg_split('/(\s+)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) ?: [$text];
        $chunks = [];
        $current = '';
        foreach ($tokens as $token) {
            while (mb_strlen($token) > self::MAX_CHUNK_CHARACTERS) {
                if (trim($current) !== '') {
                    $chunks[] = trim($current);
                    $current = '';
                }
                $chunks[] = mb_substr($token, 0, self::MAX_CHUNK_CHARACTERS);
                $token = mb_substr($token, self::MAX_CHUNK_CHARACTERS);
            }
            if ($current !== '' && mb_strlen($current . $token) > self::MAX_CHUNK_CHARACTERS) {
                $chunks[] = trim($current);
                $current = ltrim($token);
            } else {
                $current .= $token;
            }
        }
        if (trim($current) !== '') {
            $chunks[] = trim($current);
        }
        return $chunks;
    }

    /** @return array{string, int, string, bool} */
    private function request(string $url): array
    {
        $timeout = max(5, min(Config::int('TRANSLATION_TIMEOUT_SECONDS', 20), 60));
        if (!function_exists('curl_init')) {
            return $this->streamRequest($url, $timeout);
        }
        $response = '';
        $tooLarge = false;
        $curl = curl_init($url);
        if ($curl === false) {
            throw new ApiException(503, 'translation_unavailable', 'Не удалось запустить сервис перевода.');
        }
        curl_setopt_array($curl, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'ClientDataCRM/1.0',
            CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$response, &$tooLarge): int {
                if (strlen($response) + strlen($chunk) > self::MAX_RESPONSE_BYTES) {
                    $tooLarge = true;
                    return 0;
                }
                $response .= $chunk;
                return strlen($chunk);
            },
        ]);
        $completed = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if ($completed === false && !$tooLarge) {
            return ['', $status, $error !== '' ? $error : 'request_failed', false];
        }
        return [$response, $status, $error, $tooLarge];
    }

    /** @return array{string, int, string, bool} */
    private function streamRequest(string $url, int $timeout): array
    {
        if (!filter_var((string) ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOL)) {
            throw new ApiException(503, 'translation_unavailable', 'Сервис перевода недоступен на сервере.');
        }
        $context = stream_context_create(['http' => [
            'method' => 'GET',
            'header' => "Accept: application/json\r\nUser-Agent: ClientDataCRM/1.0\r\n",
            'timeout' => $timeout,
            'ignore_errors' => true,
            'follow_location' => 0,
            'max_redirects' => 0,
            'protocol_version' => 1.1,
        ]]);
        $handle = @fopen($url, 'rb', false, $context);
        if ($handle === false) {
            return ['', 0, 'connection_failed', false];
        }
        $response = stream_get_contents($handle, self::MAX_RESPONSE_BYTES + 1);
        $meta = stream_get_meta_data($handle);
        fclose($handle);
        $response = is_string($response) ? $response : '';
        $status = 0;
        foreach (($meta['wrapper_data'] ?? []) as $header) {
            if (is_string($header) && preg_match('#^HTTP/\S+\s+(\d{3})#i', $header, $match)) {
                $status = (int) $match[1];
            }
        }
        return [substr($response, 0, self::MAX_RESPONSE_BYTES), $status, '', strlen($response) > self::MAX_RESPONSE_BYTES];
    }
}
