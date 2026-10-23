<?php

declare(strict_types=1);

namespace CRM\Domain;

use CRM\Config\Config;
use CRM\Http\ApiException;

final class BusinessCardOcrService
{
    private const EMAIL = '/[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.\p{L}{2,}/u';
    private const LINKEDIN = '/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:www\.)?linkedin\.com\/[^\s,;]+/iu';
    private const URL = '/(?<![\p{L}\p{N}@.\-])(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9][a-z0-9\-]*)*\.[a-z]{2,24}(?:\/[^\s,;]*)?(?![\p{L}\p{N}@\-])/iu';
    private const PHONE = '/(?<![\p{L}\p{N}])(?<label>(?:fax|факс|f|ф|mob(?:ile)?|cell|gsm|моб|m|м|office|off|direct|dir|work|tlf|telefon|tel|phone|тел|t|т|p)\s*[.:]{0,2}\s*)?(?<number>\+?\s?\(?\d[\d\s().\-\/]{6,}\d)/iu';
    private const REGISTRY = '/(?<!\p{L})(?:nip|regon|krs|vat(?:\s?id)?|edrpou|єдрпоу|едрпоу|іпн|инн|кпп|огрн|iban|swift|bic|kvk|ust-?idnr|tax\s?id|reg\.?\s?no)(?!\p{L})/iu';
    private const LEGAL_FORM = '/(?<![\p{L}\p{N}])(?:sp\.?\s?z\.?\s?[o0]\.?\s?[o0]\.?|s\.\s?a\.|s\.?r\.?l\.?|l\.?l\.?c\.?|ltd\.?|limited|inc\.?|corp\.?|gmbh|ag|b\.?\s?v\.?|n\.?\s?v\.?|plc|kft|s\.?r\.?o\.?|d\.?o\.?o\.?|тзов|тов|прат|пат|ооо|оао|зао|пао|фоп)(?![\p{L}\p{N}])/iu';
    // Case-sensitive: "AS" / "AB" / "SIA" are legal forms, "as" / "ab" are words.
    private const LEGAL_FORM_UPPER = '/(?<![\p{L}\p{N}])(?:AS|ASA|A\/S|ApS|AB|Oy|Oyj|OÜ|UAB|SIA|SL|S\.L\.|SpA|S\.p\.A\.)(?![\p{L}\p{N}])/u';
    private const COMPANY_KEYWORD = '/(?<!\p{L})(?:group|holding|company|corporation|systems|solutions|technolog|industries|industrial|shipping|shipyard|logistics|consulting|services|partners|enterprises|agency|bureau|laborator|компані|компани|груп|холдинг|завод|верф|підприємств|предприят)/iu';
    private const POSITION = '/(?<!\p{L})(?:director|manager|founder|president|partner(?!s)|sales|marketing|engineer(?!ing)|specjalista|kierownik|dyrektor|prezes|inżynier|inzynier|handlow|daglig leder|direktør|ingeniør|konsulent|rådgiver|prosjektleder|gerente|ingeniero|geschäftsführer|leiter|vertrieb|consultant|architect|officer|specialist|coordinator|analyst|advis[eo]r|assistant|representative|superintendent|captain|broker|developer|designer|accountant|lawyer|attorney|secretary|chairman|executive|procurement|purchasing|surveyor|inspector|operations|commercial|business development|account|керівник|директор|менеджер|спеціаліст|інженер|инженер|руководител|специалист|начальник|заступник|заместител|голова|председател|засновник|основател|власник|владел|консультант|бухгалтер|юрист|капітан|капитан|представник|представител|координатор|аналітик|аналитик)|(?<!\p{L})(?:ceo|cto|cfo|coo|cio|cmo|vp|head|lead|owner|board|chief|agent|buyer|master|vice|leder|jefe)(?!\p{L})|sjef(?!\p{L})/iu';
    private const ADDRESS = '/(?<!\p{L})(?:ul|al|pl|str|ave|blvd|rd|вул|ул|пр|просп|пров|бул|пл|буд|оф)\.|(?<!\p{L})(?:street|strasse|straße|avenue|road|ulica|aleja|вулиця|улица|проспект|провулок|переулок|бульвар|площа|площадь|office|suite|floor|building|room|p\.?\s?o\.?\s?box)(?!\p{L})|(?<!\d)\d{2}-\d{3}(?!\d)|(?<![\d+])\d{5}(?!\d)|\p{L}{3,}\.?\s\d{1,4}\p{L}?(?:\s?[\/-]\s?\d{1,4}\p{L}?)?\s*(?:,|$)/iu';
    private const NAME_DECORATION = '/(?<!\p{L})(?:siv\.?\s?ing|dipl\.?\s?-?\s?ing|m\.?\s?sc|b\.?\s?sc|mba|ph\.?\s?d|dr|mr|mrs|ms|prof|eng|ing|inż|inz|mgr|c\.?\s?eng|cfa|acca|к\.?\s?т\.?\s?н|к\.?\s?е\.?\s?н|д\.?\s?т\.?\s?н)\.?(?!\p{L})/iu';
    private const CONTACT_LABEL = '/(?<!\p{L})(?:(?:tel|phone|mob|mobile|cell|gsm|fax|office|off|direct|dir|work|tlf|telefon|e-?mail|web|website|site|тел|моб|факс)\s*[.:]{0,2}|[tmfewp]\s*[.:])(?=\s|$)/iu';
    private const COUNTRIES = ['ukraine', 'україна', 'украина', 'poland', 'polska', 'польща', 'польша', 'germany', 'deutschland', 'німеччина', 'германия', 'netherlands', 'the netherlands', 'nederland', 'holland', 'belgium', 'france', 'italy', 'spain', 'portugal', 'norway', 'norge', 'sweden', 'sverige', 'finland', 'suomi', 'denmark', 'danmark', 'estonia', 'latvia', 'lithuania', 'czech republic', 'czechia', 'slovakia', 'hungary', 'romania', 'moldova', 'bulgaria', 'greece', 'turkey', 'türkiye', 'cyprus', 'malta', 'croatia', 'slovenia', 'austria', 'switzerland', 'united kingdom', 'uk', 'england', 'scotland', 'ireland', 'usa', 'united states', 'canada', 'china', 'japan', 'korea', 'singapore', 'india', 'uae', 'united arab emirates', 'georgia', 'azerbaijan', 'kazakhstan', 'israel', 'egypt'];
    private const CITIES = ['kyiv', 'kiev', 'київ', 'киев', 'lviv', 'львів', 'львов', 'odesa', 'odessa', 'одеса', 'одесса', 'kharkiv', 'харків', 'харьков', 'dnipro', 'дніпро', 'днепр', 'mykolaiv', 'миколаїв', 'николаев', 'kherson', 'херсон', 'izmail', 'ізмаїл', 'warsaw', 'warszawa', 'gdansk', 'gdynia', 'szczecin', 'krakow', 'wroclaw', 'poznan', 'lodz', 'berlin', 'hamburg', 'bremen', 'munich', 'munchen', 'rotterdam', 'amsterdam', 'antwerp', 'london', 'paris', 'oslo', 'bergen', 'stockholm', 'gothenburg', 'copenhagen', 'helsinki', 'tallinn', 'riga', 'vilnius', 'klaipeda', 'prague', 'vienna', 'istanbul', 'athens', 'piraeus', 'limassol', 'genoa', 'dubai', 'shanghai'];
    private const WEBSITE_TLDS = ['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'eu', 'ua', 'pl', 'de', 'nl', 'be', 'fr', 'it', 'es', 'pt', 'no', 'se', 'fi', 'dk', 'ee', 'lv', 'lt', 'cz', 'sk', 'hu', 'ro', 'md', 'bg', 'gr', 'tr', 'cy', 'mt', 'hr', 'si', 'at', 'ch', 'uk', 'ie', 'us', 'ca', 'cn', 'jp', 'kr', 'sg', 'in', 'ae', 'ge', 'az', 'kz', 'il', 'eg', 'online', 'site', 'tech', 'group', 'global', 'agency', 'marine', 'shipping'];
    private const FREE_MAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'ukr.net', 'i.ua', 'meta.ua', 'bigmir.net', 'mail.ru', 'yandex.ru', 'yandex.ua', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'web.de', 'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl'];

    public function __construct(private readonly ProcessRunner $runner)
    {
    }

    /** @param array<string, mixed> $file */
    public function recognize(array $file): array
    {
        $this->validateUpload($file);

        $python = AiRuntimePaths::python(trim((string) Config::get('OCR_PYTHON_BIN', 'python3')));
        $script = $this->localPath(trim((string) Config::get('OCR_PADDLE_SCRIPT', 'ai/paddleocr_business_card.py')));
        $language = trim((string) Config::get('OCR_LANGUAGE', 'uk'));
        $device = trim((string) Config::get('OCR_DEVICE', 'gpu'));
        $modelDirectory = $this->localPath(trim((string) Config::get('OCR_MODEL_DIR', '.runtime/paddleocr-models')));
        $timeout = Config::int('OCR_TIMEOUT_SECONDS', 45);
        if (!is_file($script)) {
            throw new ApiException(503, 'ocr_engine_not_configured', 'Скрипт PaddleOCR не найден по указанному пути.');
        }
        if (!is_dir($modelDirectory) && !mkdir($modelDirectory, 0770, true) && !is_dir($modelDirectory)) {
            throw new ApiException(500, 'model_storage_unavailable', 'Не удалось подготовить папку моделей PaddleOCR.');
        }
        $recognition = $this->runPaddleOcr($python, $script, (string) $file['tmp_name'], $language, $device, $modelDirectory, $timeout);
        $text = $recognition['text'];
        $classified = $this->classifyBusinessCard($text);
        $draft = $classified['draft'];

        return [
            'raw_text' => $text,
            'draft' => $draft,
            'lines' => $classified['lines'],
            'company_candidates' => $classified['company_candidates'],
            'company_domain' => $classified['company_domain'],
            'confidence' => $this->confidence($draft, $text),
            'ocr_confidence' => $recognition['average_confidence'],
            'engine' => 'PaddleOCR PP-OCRv5',
        ];
    }

    /** @param array<string, mixed> $file */
    private function validateUpload(array $file): void
    {
        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            $message = match ($error) {
                UPLOAD_ERR_INI_SIZE => 'Файл визитки превышает серверный лимит upload_max_filesize (' . ini_get('upload_max_filesize') . ').',
                UPLOAD_ERR_FORM_SIZE => 'Файл визитки превышает допустимый размер формы.',
                UPLOAD_ERR_PARTIAL => 'Файл визитки был загружен только частично. Повторите загрузку.',
                UPLOAD_ERR_NO_FILE => 'Добавьте фото или скан визитки.',
                UPLOAD_ERR_NO_TMP_DIR => 'На сервере отсутствует временная папка для загрузок.',
                UPLOAD_ERR_CANT_WRITE => 'Сервер не смог записать загруженный файл.',
                UPLOAD_ERR_EXTENSION => 'Загрузка файла остановлена расширением PHP.',
                default => 'Файл визитки не был загружен.',
            };
            $status = in_array($error, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) ? 413 : 400;
            throw new ApiException($status, 'upload_failed', $message);
        }
        $tmp = (string) ($file['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            throw new ApiException(400, 'upload_failed', 'Файл визитки не найден во временном хранилище.');
        }
        $limit = Config::int('OCR_MAX_FILE_MB', 20) * 1024 * 1024;
        if ((int) ($file['size'] ?? 0) <= 0 || (int) ($file['size'] ?? 0) > $limit) {
            throw new ApiException(413, 'file_too_large', 'Файл визитки слишком большой.');
        }
        $mime = (string) (mime_content_type($tmp) ?: '');
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'], true)) {
            throw new ApiException(415, 'unsupported_file_type', 'Загрузите изображение визитки: JPG, PNG, WebP, BMP или TIFF.');
        }
    }

    /** @return array{text:string,average_confidence:?float} */
    private function runPaddleOcr(
        string $python,
        string $script,
        string $path,
        string $language,
        string $device,
        string $modelDirectory,
        int $timeout
    ): array
    {
        $result = $this->runner->run([
            $python,
            $script,
            '--input',
            $path,
            '--language',
            $language,
            '--device',
            $device,
            '--model-dir',
            $modelDirectory,
        ], $timeout);
        if ($result->exitCode !== 0) {
            throw new ApiException(503, 'ocr_engine_failed', 'PaddleOCR не смог обработать визитку.');
        }
        $payload = json_decode(trim($result->stdout), true);
        if (!is_array($payload)) {
            throw new ApiException(503, 'ocr_engine_failed', 'PaddleOCR вернул некорректный ответ.');
        }
        $text = $this->normalizeText((string) ($payload['text'] ?? ''));
        if ($text === '') {
            throw new ApiException(422, 'ocr_no_text', 'На изображении не удалось распознать текст.');
        }

        $average = isset($payload['average_confidence']) && is_numeric($payload['average_confidence'])
            ? max(0.0, min(1.0, (float) $payload['average_confidence']))
            : null;
        return ['text' => $text, 'average_confidence' => $average];
    }

    /** @return array<string, string> */
    private function parseBusinessCard(string $text): array
    {
        return $this->classifyBusinessCard($text)['draft'];
    }

    /**
     * Labels every recognized line (contact data, name, position, company,
     * address, registry numbers) and builds the contact draft from the labels.
     *
     * @return array{draft: array<string, string>, lines: list<array{text: string, type: string}>, company_candidates: list<string>, company_domain: ?string}
     */
    private function classifyBusinessCard(string $text): array
    {
        $lines = array_values(array_filter(array_map(
            static fn (string $line): string => trim(preg_replace('/\s+/u', ' ', $line) ?? ''),
            preg_split('/\R/u', $text) ?: []
        ), static fn (string $line): bool => $line !== ''));

        /** @var list<array{text: string, type: string, label?: string}> $entries */
        $entries = [];
        foreach ($lines as $line) {
            if (preg_match(self::REGISTRY, $line) === 1) {
                $entries[] = ['text' => $line, 'type' => 'registry'];
                continue;
            }
            $rest = $line;
            foreach ($this->extract(self::EMAIL, $rest) as $value) {
                $entries[] = ['text' => $value, 'type' => 'email'];
            }
            foreach ($this->extract(self::LINKEDIN, $rest) as $value) {
                $entries[] = ['text' => $value, 'type' => 'linkedin'];
            }
            foreach ($this->extract(self::URL, $rest, fn (string $url): bool => $this->isWebsite($url)) as $value) {
                $entries[] = ['text' => $value, 'type' => 'website'];
            }
            $rest = preg_replace_callback(self::PHONE, function (array $match) use (&$entries): string {
                $digits = preg_replace('/\D+/', '', $match['number']) ?? '';
                if (strlen($digits) < 9 || strlen($digits) > 15 || (str_contains($match['number'], '/') && preg_match('/^\+|^0/', ltrim($match['number'])) !== 1)) {
                    return $match[0];
                }
                $entries[] = ['text' => trim($match['number']), 'type' => 'phone', 'label' => mb_strtolower(trim($match['label'] ?? ''))];
                return ' ';
            }, $rest) ?? $rest;

            if ($rest !== $line) {
                // Only lines that carried contact data have "T:" / "E:" style labels.
                $rest = preg_replace(self::CONTACT_LABEL, ' ', $rest) ?? $rest;
            }
            // trim() is byte-based and would cut UTF-8 letters; strip separators with /u.
            $rest = preg_replace(['/\s+/u', '/^[\s,;|•·:\-–—\/]+|[\s,;|•·:\-–—\/]+$/u'], [' ', ''], $rest) ?? $rest;
            if (preg_match_all('/\p{L}/u', $rest) >= 2) {
                $entries[] = ['text' => $rest, 'type' => $this->classifyText($rest)];
            }
        }

        $entries = $this->mergePositionLines($entries);
        $domain = $this->companyDomain($entries);
        $stem = $domain !== null ? $this->domainStem($domain) : null;
        $email = $this->firstOfType($entries, 'email');

        $nameIndex = $this->pickName($entries, $email);
        foreach ($entries as $index => $entry) {
            if ($entry['type'] === 'name' && $index !== $nameIndex) {
                $entries[$index]['type'] = 'other';
            }
        }

        $candidates = [];
        foreach ($entries as $index => $entry) {
            if (!in_array($entry['type'], ['company', 'other'], true)) {
                continue;
            }
            $score = 0;
            if ($this->hasLegalForm($entry['text'])) {
                $score += 4;
            }
            if ($stem !== null && str_contains(preg_replace('/[^\p{L}\p{N}]+/u', '', $this->fold($entry['text'])) ?? '', preg_replace('/[^\p{L}\p{N}]+/u', '', $stem) ?? $stem)) {
                $score += 3;
            }
            if (preg_match(self::COMPANY_KEYWORD, $entry['text']) === 1) {
                $score += 2;
            }
            if ($score > 0) {
                $candidates[$index] = $score;
            }
        }
        if ($candidates === []) {
            foreach ($entries as $index => $entry) {
                if ($entry['type'] === 'other' && preg_match_all('/\p{L}/u', $entry['text']) >= 3) {
                    $candidates[$index] = 0;
                    break;
                }
            }
        }
        // Highest score first; ties keep the card's top-to-bottom order.
        uksort($candidates, static fn (int $a, int $b): int => [$candidates[$b], $a] <=> [$candidates[$a], $b]);
        $companyCandidates = [];
        foreach (array_keys($candidates) as $index) {
            $entries[$index]['type'] = 'company';
            $companyCandidates[] = trim($entries[$index]['text'], " ,;");
        }
        foreach ($entries as $index => $entry) {
            if ($entry['type'] === 'company' && !isset($candidates[$index])) {
                $entries[$index]['type'] = 'other';
            }
        }

        [$firstName, $lastName] = $nameIndex !== null ? $this->splitName($this->cleanName($entries[$nameIndex]['text'])) : ['', ''];
        $address = implode(', ', array_map(
            static fn (array $entry): string => $entry['text'],
            array_values(array_filter($entries, static fn (array $entry): bool => in_array($entry['type'], ['address', 'location'], true)))
        ));
        $draft = array_filter([
            'first_name' => $firstName,
            'last_name' => $lastName,
            'position' => preg_replace('/\s*\/\s*/u', ' / ', $this->firstOfType($entries, 'position')) ?? '',
            'phone' => $this->pickPhones($entries),
            'email' => $email,
            'linkedin' => $this->firstOfType($entries, 'linkedin'),
            'website' => $this->firstOfType($entries, 'website'),
            'company' => $companyCandidates[0] ?? '',
            'address' => $address,
        ], static fn (?string $value): bool => $value !== null && trim($value) !== '');

        return [
            'draft' => $draft,
            'lines' => array_map(static fn (array $entry): array => ['text' => $entry['text'], 'type' => $entry['type']], $entries),
            'company_candidates' => $companyCandidates,
            'company_domain' => $domain,
        ];
    }

    private function classifyText(string $text): string
    {
        if (preg_match(self::ADDRESS, $text) === 1) {
            return 'address';
        }
        if ($this->isLocation($text)) {
            return 'location';
        }
        if ($this->hasLegalForm($text)) {
            return 'company';
        }
        if (preg_match(self::POSITION, $text) === 1) {
            return 'position';
        }
        if (preg_match(self::COMPANY_KEYWORD, $text) === 1) {
            return 'company';
        }
        if ($this->looksLikeName($this->cleanName($text))) {
            return 'name';
        }
        return 'other';
    }

    /**
     * OCR splits long titles across lines ("Managing Director /Naval" …
     * "Architect"), sometimes with contact lines in between.
     *
     * @param list<array{text: string, type: string, label?: string}> $entries
     * @return list<array{text: string, type: string, label?: string}>
     */
    private function mergePositionLines(array $entries): array
    {
        $merged = [];
        foreach ($entries as $index => $entry) {
            if ($entry['type'] !== 'position' || isset($merged[$index])) {
                continue;
            }
            $added = 0;
            for ($next = $index + 1; $next < count($entries) && $added < 2; $next++) {
                $candidate = $entries[$next];
                if (in_array($candidate['type'], ['email', 'phone', 'website', 'linkedin'], true)) {
                    continue;
                }
                $continues = $candidate['type'] === 'position'
                    || (in_array($candidate['type'], ['other', 'name'], true) && $this->continuesPosition($entries[$index]['text'], $candidate['text']));
                if (!$continues) {
                    break;
                }
                $entries[$index]['text'] .= ' ' . $candidate['text'];
                $merged[$next] = true;
                $added++;
            }
        }

        return array_values(array_filter($entries, static fn (int $index): bool => !isset($merged[$index]), ARRAY_FILTER_USE_KEY));
    }

    private function continuesPosition(string $current, string $next): bool
    {
        if (preg_match('/[\/&,]\s*\p{L}*$|(?<!\p{L})(?:and|of|for|in|at|&)\s*$/iu', $current) === 1) {
            return true;
        }
        return preg_match('/^\p{Ll}/u', $next) === 1
            && preg_match('/(?<!\p{L})(?:of|for|in|at|and|з|із|зі|по|у|в|та|и|\p{L})\s*$/iu', $current) === 1;
    }

    /** @param list<array{text: string, type: string, label?: string}> $entries */
    private function pickName(array $entries, string $email): ?int
    {
        // "a.kosciowska@", "hp.mueller@", "o.petrenko@" confirm which line is the person.
        $localParts = $email !== ''
            ? array_filter(preg_split('/[._+\-\d]+/', $this->latin(strstr($email, '@', true) ?: '')) ?: [])
            : [];
        $best = null;
        $bestScore = PHP_INT_MIN;
        foreach ($entries as $index => $entry) {
            if ($entry['type'] !== 'name') {
                continue;
            }
            $score = 0;
            foreach (preg_split('/\s+/u', $this->cleanName($entry['text'])) ?: [] as $word) {
                $variants = array_unique([
                    $this->latin($word),
                    $this->latin(strtr(mb_strtolower($word), ['ü' => 'ue', 'ö' => 'oe', 'ä' => 'ae'])),
                ]);
                foreach ($variants as $token) {
                    foreach ($localParts as $part) {
                        if (strlen($token) >= 3 && ($part === $token || (strlen($part) >= 4 && (str_starts_with($part, $token) || str_ends_with($part, $token))))) {
                            $score += 5;
                            break 3;
                        }
                    }
                }
            }
            if (preg_match('/^\p{Lu}/u', $entry['text']) === 1) {
                $score += 1;
            }
            $neighbours = [$entries[$index - 1]['type'] ?? '', $entries[$index + 1]['type'] ?? ''];
            if (in_array('position', $neighbours, true)) {
                $score += 1;
            }
            if ($score > $bestScore) {
                $best = $index;
                $bestScore = $score;
            }
        }

        // A capitalised phrase alone ("Pipe Spool Fabrication" on a services
        // back side) is not a person: require an email/title hint, or a card
        // that carries personal contact data at all.
        $hasContact = $email !== '' || $this->firstOfType($entries, 'phone') !== '';
        return $best !== null && ($bestScore >= 2 || $hasContact) ? $best : null;
    }

    /** @param list<array{text: string, type: string, label?: string}> $entries */
    /**
     * All non-fax numbers, mobile first, joined with "; " for the contact's
     * single phone field (VARCHAR(100)).
     *
     * @param list<array{text: string, type: string, label?: string}> $entries
     */
    private function pickPhones(array $entries): string
    {
        $phones = array_values(array_filter($entries, static fn (array $entry): bool => $entry['type'] === 'phone'));
        $isFax = static fn (array $phone): bool => preg_match('/^(?:fax|факс|f|ф)/u', $phone['label'] ?? '') === 1;
        $isMobile = static fn (array $phone): bool => preg_match('/^(?:mob|cell|gsm|моб|m|м)/u', $phone['label'] ?? '') === 1;
        $usable = array_values(array_filter($phones, static fn (array $phone): bool => !$isFax($phone))) ?: $phones;
        usort($usable, static fn (array $a, array $b): int => (int) $isMobile($b) <=> (int) $isMobile($a));

        $selected = [];
        $seen = [];
        foreach ($usable as $phone) {
            $digits = preg_replace('/\D+/', '', $phone['text']) ?? '';
            $candidate = implode('; ', [...$selected, $phone['text']]);
            if (isset($seen[$digits]) || mb_strlen($candidate) > 100) {
                continue;
            }
            $seen[$digits] = true;
            $selected[] = $phone['text'];
        }
        return implode('; ', $selected);
    }

    /** @param list<array{text: string, type: string, label?: string}> $entries */
    private function companyDomain(array $entries): ?string
    {
        foreach ($entries as $entry) {
            if ($entry['type'] === 'email') {
                $domain = mb_strtolower(substr((string) strrchr($entry['text'], '@'), 1));
                if ($domain !== '' && !in_array($domain, self::FREE_MAIL_DOMAINS, true)) {
                    return $domain;
                }
            }
        }
        foreach ($entries as $entry) {
            if ($entry['type'] === 'website') {
                $host = preg_replace('/^(?:https?:\/\/)?(?:www\.)?/i', '', mb_strtolower($entry['text'])) ?? '';
                $host = explode('/', $host)[0];
                if ($host !== '') {
                    return $host;
                }
            }
        }
        return null;
    }

    private function domainStem(string $domain): ?string
    {
        $labels = explode('.', $domain);
        $count = count($labels);
        if ($count < 2) {
            return null;
        }
        // example.com.ua / example.co.uk keep the registrable label.
        $index = $count >= 3 && in_array($labels[$count - 2], ['com', 'co', 'org', 'net', 'gov', 'in'], true) ? $count - 3 : $count - 2;
        $stem = $this->fold($labels[$index]);
        return mb_strlen($stem) >= 3 ? $stem : null;
    }

    private function isWebsite(string $url): bool
    {
        if (preg_match('/^(?:https?:\/\/|www\.)/i', $url) === 1) {
            return true;
        }
        $host = explode('/', $url)[0];
        $tld = mb_strtolower((string) substr((string) strrchr($host, '.'), 1));
        return in_array($tld, self::WEBSITE_TLDS, true);
    }

    private function isLocation(string $text): bool
    {
        static $pattern = null;
        $pattern ??= '/(?<!\p{L})(?:' . implode('|', array_map(
            fn (string $place): string => preg_quote($this->fold($place), '/'),
            array_merge(self::COUNTRIES, self::CITIES)
        )) . ')(?!\p{L})/u';
        $folded = $this->fold($text);
        if (preg_match($pattern, $folded) !== 1) {
            return false;
        }
        $remaining = preg_replace($pattern, '', $folded) ?? $folded;
        if (preg_match_all('/\p{L}/u', $remaining) < 2) {
            return true;
        }
        // "El Astillero (Cantabria) SPAIN", "6090 Fosnavaag, Norway": a short line ending in a country.
        static $country = null;
        $country ??= '/(?<!\p{L})(?:' . implode('|', array_map(
            fn (string $place): string => preg_quote($this->fold($place), '/'),
            self::COUNTRIES
        )) . ')[\s.)]*$/u';
        return preg_match($country, $folded) === 1 && count(preg_split('/\s+/u', trim($folded)) ?: []) <= 6;
    }

    private function hasLegalForm(string $text): bool
    {
        return preg_match(self::LEGAL_FORM, $text) === 1 || preg_match(self::LEGAL_FORM_UPPER, $text) === 1;
    }

    private function looksLikeName(string $text): bool
    {
        if (preg_match('/^[\p{L}\'’.\-]+(?:\s+[\p{L}\'’.\-]+){1,3}$/u', $text) !== 1) {
            return false;
        }
        // Two or more words, allowing initials ("E. Kowalski") but not initials alone.
        $words = preg_split('/\s+/u', $text) ?: [];
        $fullWords = array_filter($words, static fn (string $word): bool => preg_match_all('/\p{L}/u', $word) >= 2);
        // Names are capitalised ("skip og marin teknologi" is not), except particles like "van der".
        foreach ($fullWords as $word) {
            if (preg_match('/^\p{Lu}/u', $word) !== 1 && !in_array(mb_strtolower($word), ['van', 'von', 'der', 'den', 'de', 'da', 'di', 'du', 'la', 'le', 'del', 'dos', 'das', 'ter', 'ten', 'bin', 'al'], true)) {
                return false;
            }
        }
        return count($words) >= 2 && count($fullWords) >= 1;
    }

    private function cleanName(string $text): string
    {
        $text = preg_replace(self::NAME_DECORATION, ' ', $text) ?? $text;
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text, " ,.;");
    }

    /** @return array{0:string,1:string} */
    private function splitName(string $name): array
    {
        $parts = array_map(
            static fn (string $part): string => mb_strtoupper($part) === $part ? mb_convert_case(mb_strtolower($part), MB_CASE_TITLE) : $part,
            preg_split('/\s+/u', trim($name)) ?: []
        );
        $parts = array_values(array_filter($parts, static fn (string $part): bool => $part !== ''));
        if ($parts === []) {
            return ['', ''];
        }
        // East Slavic order "Surname Name Patronymic" is common on Ukrainian cards.
        $patronymic = '/(?:ович|евич|івна|ївна|овна|евна|ична)$/iu';
        if (count($parts) === 3 && preg_match($patronymic, $parts[2]) === 1) {
            return [$parts[1], $parts[0]];
        }
        if (count($parts) === 3 && preg_match($patronymic, $parts[1]) === 1) {
            return [$parts[0], $parts[2]];
        }
        return [$parts[0], implode(' ', array_slice($parts, 1))];
    }

    /**
     * Removes every accepted match from $text and returns the matches.
     *
     * @return list<string>
     */
    private function extract(string $pattern, string &$text, ?callable $accept = null): array
    {
        $found = [];
        $text = preg_replace_callback($pattern, static function (array $match) use (&$found, $accept): string {
            $value = trim($match[0], " \t,;|");
            if ($accept !== null && !$accept($value)) {
                return $match[0];
            }
            $found[] = $value;
            return ' ';
        }, $text) ?? $text;

        return $found;
    }

    /** @param list<array{text: string, type: string, label?: string}> $entries */
    private function firstOfType(array $entries, string $type): string
    {
        foreach ($entries as $entry) {
            if ($entry['type'] === $type) {
                return $entry['text'];
            }
        }
        return '';
    }

    private function fold(string $value): string
    {
        $value = mb_strtolower($value);
        if (class_exists(\Normalizer::class)) {
            $value = preg_replace('/\p{Mn}+/u', '', (string) \Normalizer::normalize($value, \Normalizer::FORM_D)) ?? $value;
        }
        return strtr($value, ['ł' => 'l', 'ø' => 'o', 'ß' => 'ss', 'đ' => 'd']);
    }

    /** ASCII form of a word, so Cyrillic names can be compared with Latin email addresses. */
    private function latin(string $value): string
    {
        static $transliterator = null;
        $value = $this->fold($value);
        if (class_exists(\Transliterator::class)) {
            $transliterator ??= \Transliterator::create('Any-Latin; Latin-ASCII');
            $value = $transliterator?->transliterate($value) ?: $value;
        }
        return preg_replace('/[^a-z]+/', '', strtolower($value)) ?? '';
    }

    private function normalizeText(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $lines = array_map(static fn (string $line): string => trim($line), explode("\n", $text));
        return trim(implode("\n", array_filter($lines, static fn (string $line): bool => $line !== '')));
    }

    private function localPath(string $value): string
    {
        if (str_starts_with($value, '/') || str_starts_with($value, '\\') || preg_match('/^[A-Za-z]:[\\\\\/]/', $value) === 1) {
            return $value;
        }
        return Config::root($value);
    }

    /** @param array<string, string> $draft */
    private function confidence(array $draft, string $text): string
    {
        $score = 0;
        foreach (['first_name', 'email', 'phone', 'company'] as $field) {
            if (($draft[$field] ?? '') !== '') {
                $score++;
            }
        }
        if (mb_strlen($text) > 40) {
            $score++;
        }

        return $score >= 4 ? 'high' : ($score >= 2 ? 'medium' : 'low');
    }
}
