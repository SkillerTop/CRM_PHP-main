<?php

declare(strict_types=1);

namespace CRM\Support;

use CRM\Http\ApiException;

final class ImageDataUrl
{
    /** @param list<string> $allowedMimeTypes */
    public static function validate(
        ?string $value,
        int $maxBytes,
        array $allowedMimeTypes,
        string $errorCode = 'invalid_image',
        string $message = 'Изображение имеет недопустимый формат или размер.'
    ): ?string {
        if ($value === null || trim($value) === '') {
            return null;
        }

        if (preg_match('/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+\/=_\r\n]+)$/i', trim($value), $match) !== 1) {
            throw new ApiException(400, $errorCode, $message);
        }

        $content = base64_decode(str_replace(["\r", "\n"], '', $match[2]), true);
        if ($content === false || $content === '' || strlen($content) > $maxBytes) {
            throw new ApiException(400, $errorCode, $message);
        }

        $detected = (new \finfo(FILEINFO_MIME_TYPE))->buffer($content) ?: '';
        if (!in_array($detected, $allowedMimeTypes, true) || !in_array(strtolower($match[1]), $allowedMimeTypes, true)) {
            throw new ApiException(400, $errorCode, $message);
        }

        if (@getimagesizefromstring($content) === false) {
            throw new ApiException(400, $errorCode, $message);
        }

        return 'data:' . $detected . ';base64,' . base64_encode($content);
    }
}
