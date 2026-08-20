<?php

declare(strict_types=1);

namespace CRM\Support;

use CRM\Http\ApiException;

final class UploadedFile
{
    /** @return array{extension:string,mime:string} */
    public static function validate(array $file, int $maxBytes): array
    {
        if ((int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string) ($file['tmp_name'] ?? ''))) {
            throw new ApiException(400, 'upload_failed', 'Файл не получен или загрузка завершилась ошибкой.');
        }

        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > $maxBytes) {
            throw new ApiException(413, 'file_too_large', 'Размер файла превышает допустимый лимит.');
        }

        $name = basename((string) ($file['name'] ?? ''));
        $extension = strtolower((string) pathinfo($name, PATHINFO_EXTENSION));
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file((string) $file['tmp_name']) ?: '';
        $allowed = [
            'pdf' => ['application/pdf'],
            'doc' => ['application/msword', 'application/octet-stream'],
            'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
            'xls' => ['application/vnd.ms-excel', 'application/octet-stream'],
            'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'],
            'gif' => ['image/gif'], 'webp' => ['image/webp'],
        ];
        if (!isset($allowed[$extension])) {
            throw new ApiException(400, 'file_type_not_allowed', 'Разрешены PDF, DOC/DOCX, XLS/XLSX и изображения.');
        }

        $valid = in_array($mime, $allowed[$extension], true);
        if (!$valid && in_array($extension, ['docx', 'xlsx'], true) && $mime === 'application/zip') {
            $valid = self::isOfficePackage((string) $file['tmp_name'], $extension);
        }
        if (!$valid) {
            throw new ApiException(415, 'file_type_not_allowed', 'Расширение файла не соответствует его фактическому содержимому.');
        }

        return ['extension' => $extension, 'mime' => $mime];
    }

    private static function isOfficePackage(string $path, string $extension): bool
    {
        if (class_exists(\ZipArchive::class)) {
            $zip = new \ZipArchive();
            if ($zip->open($path) !== true) {
                return false;
            }
            $hasContentTypes = $zip->locateName('[Content_Types].xml') !== false;
            $hasDocumentPart = $extension === 'docx'
                ? $zip->locateName('word/document.xml') !== false
                : $zip->locateName('xl/workbook.xml') !== false;
            $zip->close();
            return $hasContentTypes && $hasDocumentPart;
        }

        // The required production PHP extensions do not include ext-zip. ZIP
        // directory names remain uncompressed in the central directory, so we
        // can still verify the OOXML package without extracting user content.
        $content = @file_get_contents($path);
        if ($content === false || !str_starts_with($content, "PK\x03\x04")) {
            return false;
        }
        $hasContentTypes = str_contains($content, '[Content_Types].xml');
        $hasDocumentPart = $extension === 'docx'
            ? str_contains($content, 'word/document.xml')
            : str_contains($content, 'xl/workbook.xml');
        return $hasContentTypes && $hasDocumentPart;
    }
}
