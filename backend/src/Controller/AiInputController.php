<?php

declare(strict_types=1);

namespace CRM\Controller;

use CRM\Domain\BusinessCardOcrService;
use CRM\Domain\SpeechTranscriptionService;
use CRM\Http\ApiException;
use CRM\Http\Request;
use CRM\Http\Response;
use CRM\Security\AuthContext;

final class AiInputController
{
    public function __construct(
        private readonly AuthContext $auth,
        private readonly BusinessCardOcrService $ocr,
        private readonly SpeechTranscriptionService $speech
    ) {
    }

    public function businessCard(Request $request): never
    {
        $this->auth->requireWrite();
        $file = $request->file('file');
        if ($file === null) {
            throw new ApiException(400, 'file_required', 'Добавьте фото или скан визитки.');
        }

        Response::json(['data' => $this->ocr->recognize($file)]);
    }

    public function speech(Request $request): never
    {
        $this->auth->requireWrite();
        $file = $request->file('file');
        if ($file === null) {
            throw new ApiException(400, 'file_required', 'Добавьте аудиозапись.');
        }

        Response::json(['data' => $this->speech->transcribe($file)]);
    }
}
