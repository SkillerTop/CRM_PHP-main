<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\BusinessCardOcrService;
use CRM\Domain\SpeechTranscriptionService;
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
}
