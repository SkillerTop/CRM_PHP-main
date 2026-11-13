import unidecode from "unidecode";

const lookalikes: Record<string, string> = {
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
  І: "I",
  Ј: "J",
  Ѕ: "S",
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  Α: "A",
  Β: "B",
  Ε: "E",
  Ζ: "Z",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Υ: "Y",
  Χ: "X",
  ο: "o",
  α: "a",
};
const cyrillic: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  ґ: "g",
  д: "d",
  е: "e",
  ё: "e",
  є: "ie",
  ж: "zh",
  з: "z",
  и: "i",
  і: "i",
  ї: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ў: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "iu",
  я: "ia",
  ђ: "dj",
  ћ: "c",
  љ: "lj",
  њ: "nj",
  џ: "dz",
  ѓ: "gj",
  ќ: "kj",
  ѕ: "dz",
  ј: "j",
  ә: "a",
  ғ: "g",
  қ: "k",
  ң: "ng",
  ө: "o",
  ұ: "u",
  ү: "u",
  һ: "h",
  ة: "a",
  "'": "",
  "’": "",
  ʼ: "",
};
const expanded: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  å: "aa",
  ø: "oe",
  æ: "ae",
  ß: "ss",
};
const ascii: Record<string, string> = {
  ł: "l",
  ø: "o",
  ß: "ss",
  đ: "d",
  æ: "ae",
  œ: "oe",
  þ: "th",
  ð: "d",
  ı: "i",
  ħ: "h",
};
const map = (value: string, table: Record<string, string>) =>
  [...value].map((char) => table[char] ?? char).join("");
const split = (value: string) => value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const compact = (value: string) => split(value).sort().join("");
const foldVariants = (value: string) =>
  value
    .replace(
      /kh|ts|tz|x|y|j|w|g|q/g,
      (match) =>
        (
          ({
            kh: "h",
            ts: "c",
            tz: "c",
            x: "ks",
            y: "i",
            j: "i",
            w: "v",
            g: "h",
            q: "k",
          }) as Record<string, string>
        )[match]!,
    )
    .replaceAll("ie", "e")
    .replace(/(.)\1+/gu, "$1");
const skeleton = (value: string) =>
  value
    .replace(
      /sh|th|ph|kh|gh|bh|dh|jh|ch|ts|tz|ou|oo|[cqwx]/g,
      (match) =>
        (
          ({
            sh: "s",
            th: "t",
            ph: "f",
            kh: "kh",
            gh: "g",
            bh: "b",
            dh: "d",
            jh: "j",
            ch: "ch",
            ts: "c",
            tz: "c",
            ou: "v",
            oo: "v",
            c: "k",
            q: "k",
            w: "v",
            x: "ks",
          }) as Record<string, string>
        )[match]!,
    )
    .replace(/[aeiouy]+/g, "")
    .replace(/(.)\1+/gu, "$1");
function latin(value: string): string {
  const transliterated = map(value, cyrillic)
    .replace(/[Χχ]/g, "ch")
    .replace(/[ήΗη]/g, "i");
  return map(
    unidecode(transliterated)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}|\p{Lm}/gu, ""),
    ascii,
  );
}
export function identicalName(left: string, right: string): boolean {
  const normalized = (value: string) =>
    value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
  return normalized(left) !== "" && normalized(left) === normalized(right);
}
export type NameKeys = {
  visual: string;
  latin: string[];
  compact: string[];
  skeleton: string;
  vowelOptional: boolean;
};
export function nameKeys(value: string): NameKeys {
  const normalized = value.normalize("NFKC"),
    lower = normalized.toLowerCase();
  const spellings = [latin(lower)];
  const extended = map(lower, expanded);
  if (extended !== lower) spellings.push(latin(extended));
  const latinKeys = spellings
    .map((spelling) => split(spelling).map(foldVariants).sort().join(" "))
    .filter(Boolean);
  const compactKeys = spellings
    .map((spelling) => split(spelling).map(foldVariants).join(""))
    .filter(Boolean);
  const visual = split(
    map(normalized, lookalikes)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, ""),
  )
    .sort()
    .join(" ");
  return {
    visual,
    latin: [...new Set(latinKeys)],
    compact: [...new Set(compactKeys)],
    skeleton: split(spellings[0] ?? "")
      .map(skeleton)
      .sort()
      .join(" "),
    vowelOptional:
      /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
        normalized,
      ),
  };
}
export function matchingNames(a: NameKeys, b: NameKeys): boolean {
  if (a.visual && a.visual === b.visual) return true;
  if (
    a.latin.some((x) => b.latin.includes(x)) ||
    a.compact.some((x) => b.compact.includes(x))
  )
    return true;
  return (
    (a.vowelOptional || b.vowelOptional) &&
    a.skeleton === b.skeleton &&
    a.skeleton.replaceAll(" ", "").length >= 3
  );
}
export const sameName = (left: string, right: string) =>
  matchingNames(nameKeys(left), nameKeys(right));
