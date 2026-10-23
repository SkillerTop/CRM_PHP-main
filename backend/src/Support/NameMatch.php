<?php

declare(strict_types=1);

namespace CRM\Support;

/**
 * Loose comparison of person and company names written in different alphabets, used to warn about
 * likely duplicates: "Acme" typed with Cyrillic lookalike letters, "Иван Петров" vs "Ivan Petrov",
 * "Côte" vs "Cote", "Müller" vs "Mueller", "محمد" vs "Mohammed", "Ｆｕｌｌｗｉｄｔｈ", "Petrov Ivan" vs "Ivan Petrov".
 * Uses ICU (php-intl) for confusable letters of every script and for transliteration; without intl the
 * built-in Latin/Cyrillic/Greek tables still apply.
 */
final class NameMatch
{
    /** Cyrillic and Greek letters that render like Latin ones; fallback when ICU confusables are unavailable. */
    private const LOOKALIKES = [
        'А' => 'A', 'В' => 'B', 'Е' => 'E', 'К' => 'K', 'М' => 'M', 'Н' => 'H', 'О' => 'O', 'Р' => 'P', 'С' => 'C',
        'Т' => 'T', 'У' => 'Y', 'Х' => 'X', 'І' => 'I', 'Ј' => 'J', 'Ѕ' => 'S',
        'а' => 'a', 'в' => 'b', 'е' => 'e', 'к' => 'k', 'м' => 'm', 'н' => 'h', 'о' => 'o', 'р' => 'p', 'с' => 'c',
        'т' => 't', 'у' => 'y', 'х' => 'x', 'і' => 'i', 'ј' => 'j', 'ѕ' => 's', 'ԁ' => 'd',
        'Α' => 'A', 'Β' => 'B', 'Ε' => 'E', 'Ζ' => 'Z', 'Η' => 'H', 'Ι' => 'I', 'Κ' => 'K', 'Μ' => 'M', 'Ν' => 'N',
        'Ο' => 'O', 'Ρ' => 'P', 'Τ' => 'T', 'Υ' => 'Y', 'Χ' => 'X', 'ο' => 'o', 'α' => 'a',
    ];

    /**
     * Cyrillic letters (Russian, Ukrainian, Belarusian, Serbian, Macedonian, Kazakh) as usually spelled in Latin documents,
     * plus Arabic word-final ة, which names spell as -a (فاطمة = Fatima). ICU handles every other script.
     */
    private const CYRILLIC = [
        'а' => 'a', 'б' => 'b', 'в' => 'v', 'г' => 'g', 'ґ' => 'g', 'д' => 'd', 'е' => 'e', 'ё' => 'e', 'є' => 'ie',
        'ж' => 'zh', 'з' => 'z', 'и' => 'i', 'і' => 'i', 'ї' => 'i', 'й' => 'i', 'к' => 'k', 'л' => 'l', 'м' => 'm',
        'н' => 'n', 'о' => 'o', 'п' => 'p', 'р' => 'r', 'с' => 's', 'т' => 't', 'у' => 'u', 'ў' => 'u', 'ф' => 'f',
        'х' => 'kh', 'ц' => 'ts', 'ч' => 'ch', 'ш' => 'sh', 'щ' => 'shch', 'ъ' => '', 'ы' => 'y', 'ь' => '', 'э' => 'e',
        'ю' => 'iu', 'я' => 'ia', 'ђ' => 'dj', 'ћ' => 'c', 'љ' => 'lj', 'њ' => 'nj', 'џ' => 'dz', 'ѓ' => 'gj', 'ќ' => 'kj',
        'ѕ' => 'dz', 'ј' => 'j', 'ә' => 'a', 'ғ' => 'g', 'қ' => 'k', 'ң' => 'ng', 'ө' => 'o', 'ұ' => 'u', 'ү' => 'u', 'һ' => 'h',
        '’' => '', "'" => '', 'ʼ' => '', 'ة' => 'a',
    ];

    /** Letters that German and Scandinavian names also spell out: Müller = Mueller, Åsa = Aasa. */
    private const EXPANDED_LETTERS = ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'å' => 'aa', 'ø' => 'oe', 'æ' => 'ae', 'ß' => 'ss'];

    /** Accented Latin letters by base letter; used only when php-intl (Normalizer) is missing. */
    private const ACCENTED_LATIN = [
        'a' => 'àáâãäåāăą', 'c' => 'çćĉċč', 'd' => 'ď', 'e' => 'èéêëēĕėęě', 'g' => 'ĝğġģ', 'h' => 'ĥ', 'i' => 'ìíîïĩīĭį',
        'j' => 'ĵ', 'k' => 'ķ', 'l' => 'ĺļľŀ', 'n' => 'ñńņň', 'o' => 'òóôõöōŏő', 'r' => 'ŕŗř', 's' => 'śŝşšș', 't' => 'ţťț',
        'u' => 'ùúûüũūŭůűų', 'w' => 'ŵ', 'y' => 'ýÿŷ', 'z' => 'źżž',
    ];

    private const ASCII_LETTERS = ['ł' => 'l', 'ø' => 'o', 'ß' => 'ss', 'đ' => 'd', 'æ' => 'ae', 'œ' => 'oe', 'þ' => 'th', 'ð' => 'd', 'ı' => 'i', 'ħ' => 'h'];

    /** Spelling variants of one transliterated sound (Yurii/Iurii/Yuriy, Olga/Olha, Alexander/Aleksander, Petrow, Qasim/Kasim). */
    private const LATIN_VARIANTS = ['kh' => 'h', 'x' => 'ks', 'y' => 'i', 'j' => 'i', 'w' => 'v', 'g' => 'h', 'q' => 'k', 'ts' => 'c', 'tz' => 'c'];

    /** Consonant spellings for scripts whose vowels are optional or romanized many ways (محمد = Mohammed, Χρήστος = Christos). */
    private const SKELETON_CONSONANTS = [
        'sh' => 's', 'th' => 't', 'ph' => 'f', 'kh' => 'k', 'gh' => 'g', 'bh' => 'b', 'dh' => 'd', 'jh' => 'j',
        'ch' => 'ch', 'c' => 'k', 'q' => 'k', 'w' => 'v', 'x' => 'ks', 'ts' => 'c', 'tz' => 'c', 'ou' => 'v', 'oo' => 'v',
    ];

    private const VOWEL_OPTIONAL_SCRIPTS = '/[\p{Arabic}\p{Hebrew}\p{Syriac}\p{Thaana}\p{Greek}\p{Devanagari}\p{Bengali}\p{Gurmukhi}\p{Gujarati}'
        . '\p{Oriya}\p{Tamil}\p{Telugu}\p{Kannada}\p{Malayalam}\p{Sinhala}\p{Thai}\p{Lao}\p{Khmer}\p{Myanmar}\p{Tibetan}]/u';

    /** The same name apart from letter case and spacing; accents, punctuation and alphabet still count. */
    public static function identical(string $left, string $right): bool
    {
        $plain = static fn (string $value): string => mb_strtolower(trim(preg_replace('/\s+/u', ' ', self::nfc($value)) ?? $value));
        return $plain($left) !== '' && $plain($left) === $plain($right);
    }

    public static function same(string $left, string $right): bool
    {
        return self::matches(self::keys($left), self::keys($right));
    }

    /**
     * Compares precomputed keys, so one new name can be checked against many stored ones.
     *
     * @param array{visual:string,latin:list<string>,compact:list<string>,skeleton:string,vowelOptional:bool} $a
     * @param array{visual:string,latin:list<string>,compact:list<string>,skeleton:string,vowelOptional:bool} $b
     */
    public static function matches(array $a, array $b): bool
    {
        if ($a['visual'] !== '' && ($a['visual'] === $b['visual'] || self::confusable($a['visual'], $b['visual']))) {
            return true;
        }
        if (array_intersect($a['latin'], $b['latin']) !== [] || array_intersect($a['compact'], $b['compact']) !== []) {
            return true;
        }
        return ($a['vowelOptional'] || $b['vowelOptional']) && $a['skeleton'] === $b['skeleton']
            && mb_strlen(str_replace(' ', '', $a['skeleton'])) >= 3;
    }

    /** @return array{visual:string,latin:list<string>,compact:list<string>,skeleton:string,vowelOptional:bool} */
    public static function keys(string $value): array
    {
        $value = self::nfkc($value);
        $lower = mb_strtolower($value);
        $spellings = [self::latin($lower)];
        if (strtr($lower, self::EXPANDED_LETTERS) !== $lower) {
            $spellings[] = self::latin(strtr($lower, self::EXPANDED_LETTERS));
        }
        $latin = $compact = [];
        foreach ($spellings as $spelling) {
            $words = array_map([self::class, 'foldVariants'], self::split($spelling));
            $compact[] = implode('', $words);
            sort($words, SORT_STRING);
            $latin[] = implode(' ', $words);
        }
        $visual = self::split(self::stripMarks(mb_strtolower(strtr($value, self::LOOKALIKES))));
        sort($visual, SORT_STRING);
        $skeleton = array_map([self::class, 'skeleton'], self::split($spellings[0]));
        sort($skeleton, SORT_STRING);
        return [
            'visual' => implode(' ', $visual),
            'latin' => array_values(array_unique(array_filter($latin))),
            'compact' => array_values(array_unique(array_filter($compact))),
            'skeleton' => trim(implode(' ', $skeleton)),
            'vowelOptional' => preg_match(self::VOWEL_OPTIONAL_SCRIPTS, $value) === 1,
        ];
    }

    /** Unicode confusables for every script: Cyrillic "раураl" = "paypal", Greek "ΑΒΓ" lookalikes, "rn" = "m". */
    private static function confusable(string $left, string $right): bool
    {
        static $checker = null;
        if ($right === '' || !class_exists(\Spoofchecker::class)) {
            return false;
        }
        $checker ??= new \Spoofchecker();
        return $checker->areConfusable($left, $right);
    }

    private static function latin(string $value): string
    {
        static $transliterator = null;
        $value = strtr($value, self::CYRILLIC);
        if (class_exists(\Transliterator::class)) {
            $transliterator ??= \Transliterator::create('Any-Latin; Latin-ASCII');
            $value = $transliterator?->transliterate($value) ?: $value;
        }
        // Modifier letters left by romanization (Arabic ʿayn, ʾalif) carry no spelling of their own.
        $value = preg_replace('/\p{Lm}+/u', '', self::stripMarks(mb_strtolower($value))) ?? $value;
        return strtr($value, self::ASCII_LETTERS);
    }

    /** @return list<string> */
    private static function split(string $value): array
    {
        return preg_split('/[^\p{L}\p{N}]+/u', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    private static function foldVariants(string $word): string
    {
        $word = str_replace('ie', 'e', strtr($word, self::LATIN_VARIANTS));
        return preg_replace('/(.)\1+/u', '$1', $word) ?? $word;
    }

    private static function skeleton(string $word): string
    {
        // Mapped again after dropping vowels, so "Cohen" (k-h-n) meets Hebrew כהן (kh-n).
        $word = preg_replace('/[aeiouy]+/', '', strtr($word, self::SKELETON_CONSONANTS)) ?? $word;
        $word = strtr($word, self::SKELETON_CONSONANTS);
        return preg_replace('/(.)\1+/u', '$1', $word) ?? $word;
    }

    /** One encoding of each accented letter: "ô" typed as o + combining circumflex equals precomposed "ô". */
    private static function nfc(string $value): string
    {
        return class_exists(\Normalizer::class) ? ((string) \Normalizer::normalize($value, \Normalizer::FORM_C) ?: $value) : $value;
    }

    /** Compatibility forms become plain letters: fullwidth "Ａｃｍｅ", math "𝐀𝐜𝐦𝐞", ligature "ﬁ", superscripts. */
    private static function nfkc(string $value): string
    {
        return class_exists(\Normalizer::class) ? ((string) \Normalizer::normalize($value, \Normalizer::FORM_KC) ?: $value) : $value;
    }

    /** Expects lowercase text. */
    private static function stripMarks(string $value): string
    {
        static $accented = null;
        if (class_exists(\Normalizer::class)) {
            $value = (string) \Normalizer::normalize($value, \Normalizer::FORM_D) ?: $value;
        } else {
            if ($accented === null) {
                $accented = [];
                foreach (self::ACCENTED_LATIN as $base => $letters) {
                    $accented += array_fill_keys(mb_str_split($letters), $base);
                }
            }
            $value = strtr($value, $accented);
        }
        return preg_replace('/\p{M}+/u', '', $value) ?? $value;
    }
}
