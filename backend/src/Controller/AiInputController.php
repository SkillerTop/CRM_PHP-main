<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\BusinessCardOcrService;
use CRM\Domain\CompanyWebsiteLookupService;
use CRM\Domain\SpeechTranscriptionService;
use CRM\Domain\TranslationService;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;
use CRM\Security\ResourceGuard;
use CRM\Config\Config;

final class AiInputController
{
    public function __construct(
        private readonly AuthContext $auth,
        private readonly BusinessCardOcrService $ocr,
        private readonly SpeechTranscriptionService $speech,
        private readonly TranslationService $translation,
        private readonly CompanyWebsiteLookupService $websiteLookup,
        private readonly ResourceGuard $resources
    ) {
    }

    public function businessCard(Request $request): never
    {
        $this->auth->requireWrite();
        $file = $request->file('file');
        if ($file === null) {
            throw new ApiException(400, 'file_required', 'Добавьте фото или скан визитки.');
        }

        $this->resources->consume('ocr', $this->auth->userId(), Config::int('OCR_MAX_REQUESTS_PER_HOUR', 20));
        $result = $this->resources->exclusive('ocr', fn (): array => $this->ocr->recognize($file));
        Response::json(['data' => $result]);
    }

    public function speech(Request $request): never
    {
        $this->auth->requireWrite();
        $file = $request->file('file');
        if ($file === null) {
            throw new ApiException(400, 'file_required', 'Добавьте аудиозапись.');
        }

        $this->resources->consume('speech', $this->auth->userId(), Config::int('WHISPER_MAX_REQUESTS_PER_HOUR', 10));
        $result = $this->resources->exclusive('speech', fn (): array => $this->speech->transcribe($file));
        Response::json(['data' => $result]);
    }

    /** Company description, address and logo from the company's own website (prefill only, nothing is saved). */
    public function companyWebsite(Request $request): never
    {
        $this->auth->requireWrite();
        if (!Config::bool('COMPANY_LOOKUP_ENABLED', true)) {
            throw new ApiException(503, 'lookup_disabled', 'Поиск данных компании по сайту отключён.');
        }
        $website = trim((string) ($request->json()['website'] ?? ''));
        if ($website === '' || mb_strlen($website) > 255) {
            throw new ApiException(422, 'lookup_invalid_url', 'Укажите адрес сайта в формате example.com.');
        }

        $this->resources->consume('company_lookup', $this->auth->userId(), Config::int('COMPANY_LOOKUP_MAX_REQUESTS_PER_HOUR', 60));
        Response::json(['data' => $this->websiteLookup->lookup($website)]);
    }

    public function translate(Request $request): never
    {
        $this->auth->requireWrite();
        $text = trim((string) ($request->json()['text'] ?? ''));
        $this->resources->consume('translation', $this->auth->userId(), Config::int('TRANSLATION_MAX_REQUESTS_PER_HOUR', 120));
        Response::json(['data' => ['text' => $this->translation->toEnglish($text)]]);
    }
}
