<?php

declare(strict_types=1);

use CRM\Support\NameMatch;

require dirname(__DIR__) . '/backend/src/autoload.php';

// Spellings of one name across alphabets, keyboards and transliteration styles must be flagged as possible duplicates.
foreach ([
    ['Acme', "\u{0410}\u{0441}me"],                   // Cyrillic А and с typed inside a Latin name
    ['ACME', "\u{0410}\u{0421}\u{041C}\u{0415}"],     // all-Cyrillic lookalike capitals
    ['Anna Smith', 'Ānna Smith'],
    ['Anna Smith', 'anna  SMITH'],
    ['Anna Smith', 'Smith, Anna'],
    ['Иван Петров', 'Ivan Petrov'],
    ['Петров Иван', 'Ivan Petrov'],
    ['Юрий Ковальчук', 'Yuriy Kovalchuk'],
    ['Юрій Ковальчук', 'Iurii Kovalchuk'],
    ['Ольга', 'Olha'],
    ['Ольга', 'Olga'],
    ['Мария', 'Mariya'],
    ['Евгений', 'Yevgeniy'],
    ['Александр', 'Aleksandr'],
    ['Харків', 'Kharkiv'],
    ['Щербаков', 'Shcherbakov'],
    ['Фёдор', 'Федор'],
    ['Фёдор', 'Fedor'],
    ['Müller GmbH', 'Muller GmbH'],
    ['Cote Bleue', 'Côte Bleue'],                     // circumflex added later
    ['Pâte Fête Île Hôtel Sûr', 'pate fete ile hotel sur'],
    ['RÔLE', 'role'],
    ["Co\u{0302}te", 'Côte'],                         // decomposed ô (o + combining circumflex)
    ['Jean-René Lefèvre', 'Jean Rene Lefevre'],
    ['François', 'Francois'],
    ['Ştefan Țară', 'Stefan Tara'],
    ['Ромашка', 'Romashka'],
    ['Müller', 'Mueller'],                            // umlaut spelled out
    ['Åsa', 'Aasa'],
    ['Þór', 'Thor'],
    ['Łukasz', 'Lukasz'],
    ['Şükrü', 'Sukru'],
    ['İstanbul Ltd', 'Istanbul Ltd'],
    ['Ａｃｍｅ', 'Acme'],                              // fullwidth
    ['𝐀𝐜𝐦𝐞', 'Acme'],                                // mathematical bold
    ['ﬁrma', 'Firma'],                                // ligature
    ['Coca-Cola', 'CocaCola'],
    ['PayPal', 'Раураl'],                             // Cyrillic lookalikes (Unicode confusables)
    ['Ђорђе Петровић', 'Djordje Petrovic'],           // Serbian
    ['Љубица', 'Ljubica'],
    ['Нұрлан', 'Nurlan'],                             // Kazakh
    ['Цветков', 'Tsvetkov'],
    ['Moritz', 'Мориц'],
    ['Χρήστος Παπαδόπουλος', 'Christos Papadopoulos'], // Greek
    ['Ελλάδα Α.Ε.', 'Ellada A.E.'],
    ['محمد علي', 'Mohammed Ali'],                     // Arabic
    ['محمد علي', 'Muhammad Ali'],
    ['محمود', 'Mahmoud'],
    ['يوسف', 'Yousef'],
    ['أحمد', 'Ahmed'],
    ['فاطمة', 'Fatima'],
    ['דוד כהן', 'David Cohen'],                       // Hebrew
    ['Արամ', 'Aram'],                                 // Armenian
    ['გიორგი', 'Giorgi'],                             // Georgian
    ['राम शर्मा', 'Ram Sharma'],                       // Devanagari
    ['สมชาย', 'Somchai'],                             // Thai
    ['王伟', 'Wang Wei'],                              // Chinese (pinyin)
    ['たなか', 'Tanaka'],                              // Hiragana
    ['タナカ', 'Tanaka'],                              // Katakana
] as [$left, $right]) {
    if (!NameMatch::same($left, $right) || !NameMatch::same($right, $left)) {
        throw new RuntimeException("Names should match: {$left} / {$right}");
    }
}

// Different people and companies must not be flagged.
foreach ([
    ['Anna Smith', 'Anna Smyth Jones'],
    ['Иван Петров', 'Иван Сидоров'],
    ['Ivan Petrov', 'Ivan Petrova Ltd'],
    ['Company 1', 'Company 2'],
    ['Acme', 'Acne'],
    ['Олег', 'Ольга'],
    ['محمد', 'Mahmoud'],
    ['محمود', 'Mohammed'],
    ['Ali', 'Lee'],
    ['דוד', 'Dan'],
    ['Wang Wei', 'Wang Wu'],
    ['Christos', 'Kostas'],
    ['Ram', 'Rima'],
    ['Anna', 'Nina'],
    ['Somchai', 'Somsak'],
    ['', ''],
    ['---', '***'],
] as [$left, $right]) {
    if (NameMatch::same($left, $right)) {
        throw new RuntimeException("Names should differ: {$left} / {$right}");
    }
}

// Identical company and contact names are refused outright; only letter case and spacing are ignored.
foreach ([['Acme', 'Acme'], ['Acme Ltd', 'ACME  ltd '], ['Ivan Petrov', 'IVAN  petrov'], ['Иван Петров', 'иван петров'], ["Co\u{0302}te", 'Côte'], ['Ромашка', 'РОМАШКА']] as [$left, $right]) {
    if (!NameMatch::identical($left, $right)) {
        throw new RuntimeException("Names should be identical: {$left} / {$right}");
    }
}
// These are only similar: the user may still confirm the save.
foreach ([['Acme', 'Ācme'], ['Cote', 'Côte'], ['Ivan Petrov', 'Petrov Ivan'], ['Иван Петров', 'Ivan Petrov'], ['Anna Smith', 'Ānna Smith'], ['Acme, Inc.', 'Acme Inc'], ['Acme', "\u{0410}\u{0441}me"], ['Ромашка', 'Romashka'], ['', '']] as [$left, $right]) {
    if (NameMatch::identical($left, $right)) {
        throw new RuntimeException("Names should not be identical: {$left} / {$right}");
    }
}

echo "Name matching checks passed\n";
