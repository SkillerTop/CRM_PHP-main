<?php

declare(strict_types=1);

use CRM\Domain\BusinessCardOcrService;
use CRM\Domain\ProcessRunner;

require dirname(__DIR__) . '/backend/src/autoload.php';

$service = new BusinessCardOcrService(new ProcessRunner());
$parse = (new ReflectionClass($service))->getMethod('parseBusinessCard');

$examples = [
    ["JOHN SMITH\nSales\nDirector\n+44 20 1234 5678\njohn@example.com", 'Sales Director', null],
    ["ОЛЕКСАНДР ПЕТРЕНКО\nДиректор з г\nпродажу\n+380 67 123 45 67\ncontact@example.com", 'Директор з г продажу', null],
    ["JANE DOE\nSales Director\nExample Solutions LLC\njane@example.com\nwww.example.org", 'Sales Director', 'Example Solutions LLC'],
    ["JANE DOE\nSales Director\nacme industries\njane@example.com", 'Sales Director', 'acme industries'],
];

foreach ($examples as [$text, $expectedPosition, $expectedCompany]) {
    $draft = $parse->invoke($service, $text);
    if (($draft['position'] ?? null) !== $expectedPosition || ($draft['company'] ?? null) !== $expectedCompany) {
        throw new RuntimeException('OCR draft parsed the position or company incorrectly: ' . json_encode($draft, JSON_UNESCAPED_UNICODE));
    }
    if (!str_contains($text, 'www.') && isset($draft['website'])) {
        throw new RuntimeException('Email domain was incorrectly parsed as a website.');
    }
    if (str_contains($text, 'www.example.org') && ($draft['website'] ?? null) !== 'www.example.org') {
        throw new RuntimeException('Explicit website was not parsed.');
    }
}

echo "Business-card OCR parsing passed.\n";
