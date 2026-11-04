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

// Whole cards as PaddleOCR returns them: lines out of reading order, degrees,
// wrapped titles, legal forms, labelled phones, and registry numbers.
$cards = [
    [
        "CONOSHIP\nINTERNATIONAL\nCONOSHIP INTERNATIONAL POLAND SP.Z O.O.\nGDANSK, POLAND\nul. ptk. Jana Patubickiego 6\n80-175 Gdask\nPoland\nAgnieszka Kosciowska MSc\na.kosciowska@conoship.com\nManaging Director /Naval\nwww.conoship.com\nArchitect\n+48 698144077\nNIP: 9571127885, REGON: 387341681, KRS: 0000865148",
        ['first_name' => 'Agnieszka', 'last_name' => 'Kosciowska', 'position' => 'Managing Director / Naval Architect', 'phone' => '+48 698144077', 'email' => 'a.kosciowska@conoship.com', 'website' => 'www.conoship.com', 'company' => 'CONOSHIP INTERNATIONAL POLAND SP.Z O.O.'],
    ],
    [
        "ТОВ «МОРСЬКІ СИСТЕМИ»\nПЕТРЕНКО Олександр Іванович\nКомерційний директор\nвул. Пушкінська 12, оф. 5\n65026 Одеса, Україна\nТел.: +380 48 123 45 67\nМоб.: +380 67 765 43 21\nФакс: +380 48 123 45 68\no.petrenko@marsys.com.ua\nЄДРПОУ 12345678",
        ['first_name' => 'Олександр', 'last_name' => 'Петренко', 'position' => 'Комерційний директор', 'phone' => '+380 67 765 43 21; +380 48 123 45 67', 'email' => 'o.petrenko@marsys.com.ua', 'company' => 'ТОВ «МОРСЬКІ СИСТЕМИ»'],
    ],
    [
        "Dr. Hans-Peter MÜLLER\nHead of Technical Services\nNordwind Shipping GmbH\nHafenstraße 21, 20457 Hamburg\nT: +49 40 1234 5678 | M: +49 171 2345678\nE: hp.mueller@nordwind-shipping.de\nnordwind-shipping.de",
        ['first_name' => 'Hans-Peter', 'last_name' => 'Müller', 'position' => 'Head of Technical Services', 'phone' => '+49 171 2345678; +49 40 1234 5678', 'email' => 'hp.mueller@nordwind-shipping.de', 'website' => 'nordwind-shipping.de', 'company' => 'Nordwind Shipping GmbH'],
    ],
    [
        // Nordic "AS" legal form, "Office." label, mobile preferred, logo text without spaces.
        "NORDHAVdesign\nKari Nordmann Olsen\nMob. +47 48152925\nVice President Sales\nOffice. +47 70 08 01 80\nNordhav Design AS\nkno@nordhavdesign.no",
        ['first_name' => 'Kari', 'last_name' => 'Nordmann Olsen', 'position' => 'Vice President Sales', 'phone' => '+47 48152925; +47 70 08 01 80', 'email' => 'kno@nordhavdesign.no', 'company' => 'Nordhav Design AS'],
    ],
    [
        // Norwegian degree and title, Polish-style "sp. z 0.o." misread, country-ending location line.
        "Ola Fjordvik\nSiv.ing. skip og marin teknologi\nDaglig leder\nFjordvik Marine sp. z 0.o.\nEl Puerto (Cantabria) SPAIN\nola@fjordvik.no\n+47 9008 2899",
        ['first_name' => 'Ola', 'last_name' => 'Fjordvik', 'position' => 'Daglig leder', 'phone' => '+47 9008 2899', 'email' => 'ola@fjordvik.no', 'company' => 'Fjordvik Marine sp. z 0.o.'],
    ],
    [
        // Services back side: no person, slogan is not a title, ISO process codes are not a phone.
        "ACMEPIPE\nPiping systems & HVAC solutions\nPipe Spool Fabrication\nship design · engineering • consultancy\n(135 / 136 / 138 / 141\nwww.acmepipe.eu",
        ['website' => 'www.acmepipe.eu', 'company' => 'ACMEPIPE'],
    ],
    [
        "BLUE ANCHOR\nE. Kowalski\nOwner\ne.kowalski@gmail.com\n+48 600 100 200",
        ['first_name' => 'E.', 'last_name' => 'Kowalski', 'position' => 'Owner', 'phone' => '+48 600 100 200', 'email' => 'e.kowalski@gmail.com', 'company' => 'BLUE ANCHOR'],
    ],
    [
        // Office list header, Spanish two given names and two surnames confirmed by "jl." in the email.
        "GÜTEBORG|SWEDEN TRIESTE|ITALY BARCELONA|SPAIN\nNAOS-BCN\nJose Luis Linares Llamas\nSHUPANO BOAT DESAGN\nTechnical Director | NAOS Ship & Boat Design\n+34 633 26 31\n08870,Carrer San Sebastia\nTel:\nBarcelona, Spain\nAddress\njl.linares@naos-bcn.com\nWebsite: www.naos-bcn.com\nEmail:\nEscola dEnginyeria de Barcelona Est - EEBE1 Alumnus",
        ['first_name' => 'Jose Luis', 'last_name' => 'Linares Llamas', 'position' => 'Technical Director | NAOS Ship & Boat Design', 'phone' => '+34 633 26 31', 'email' => 'jl.linares@naos-bcn.com', 'website' => 'www.naos-bcn.com', 'company' => 'NAOS-BCN'],
    ],
];

foreach ($cards as [$text, $expected]) {
    $draft = $parse->invoke($service, $text);
    unset($draft['address']);
    if ($draft != $expected) {
        throw new RuntimeException('OCR card was classified incorrectly: ' . json_encode($draft, JSON_UNESCAPED_UNICODE));
    }
}

// An office list names several countries; it is neither the address nor a location.
$classify = (new ReflectionClass($service))->getMethod('classifyBusinessCard');
$naos = $classify->invoke($service, end($cards)[0]);
if ($naos['lines'][0]['type'] !== 'offices' || str_contains($naos['draft']['address'] ?? '', 'TRIESTE')) {
    throw new RuntimeException('Office list was read as the card address: ' . json_encode($naos['lines'][0], JSON_UNESCAPED_UNICODE));
}

// Baseline-grouped lines keep labels with their values; the address label is not part of the address.
$labelled = $classify->invoke($service, "GÖTEBORG | SWEDEN TRIESTE | ITALY BARCELONA SPAIN\nNAOS-BCN\nSHUP AND BOAT DESIGN\nJose Luis Linares Llamas\nTechnical Director | NAOS Ship & Boat Design\n+34 633 26 31\nTel:\nAddress: 08870, Carrer San Sebastià,\nBarcelona, Spain\nEmail: jl.linares@naos-bcn.com\nWebsite: www.naos-bcn.com\nEscola d'Enginyeria de Barcelona Est - EEBE \\ Alumnus");
$expectedLabelled = ['first_name' => 'Jose Luis', 'last_name' => 'Linares Llamas', 'email' => 'jl.linares@naos-bcn.com', 'address' => '08870, Carrer San Sebastià, Barcelona, Spain'];
if (array_intersect_key($labelled['draft'], $expectedLabelled) != $expectedLabelled) {
    throw new RuntimeException('Labelled NAOS card was parsed incorrectly: ' . json_encode($labelled['draft'], JSON_UNESCAPED_UNICODE));
}

// Four capitalised words without an email hint: two given names, two surnames.
$split = (new ReflectionClass($service))->getMethod('splitName');
if ($split->invoke($service, 'Maria Jose Garcia Lopez') !== ['Maria Jose', 'Garcia Lopez']) {
    throw new RuntimeException('Four-word name was split incorrectly.');
}

echo "Business-card OCR parsing passed.\n";
