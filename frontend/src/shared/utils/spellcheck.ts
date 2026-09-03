export type SpellLanguage = "en" | "ru" | "uk";

export type SpellChecker = {
  correct: (word: string) => boolean;
  suggest: (word: string) => string[];
};

export type SpellcheckIssue = {
  id: string;
  word: string;
  start: number;
  end: number;
  language: SpellLanguage;
  suggestions: string[];
};

const WORD_PATTERN = /[\p{L}]+(?:['’ʼ-][\p{L}]+)*/gu;
const UKRAINIAN_MARKERS = /[іїєґ]/iu;
const CYRILLIC = /[а-яёіїєґ]/iu;
const LATIN = /[a-z]/iu;
const CUSTOM_WORDS = new Set([
  "api", "cjn", "crm", "email", "ffmpeg", "linkedin", "openai", "php", "t9", "webm", "whisper",
]);

function normalizedWord(word: string) {
  return word.toLocaleLowerCase().replace(/[’ʼ]/gu, "'");
}

function preferredCyrillicLanguage(text: string): "ru" | "uk" {
  return UKRAINIAN_MARKERS.test(text) ? "uk" : "ru";
}

function candidateLanguages(word: string, text: string): SpellLanguage[] {
  if (UKRAINIAN_MARKERS.test(word)) return ["uk"];
  if (CYRILLIC.test(word)) {
    const preferred = preferredCyrillicLanguage(text);
    return preferred === "uk" ? ["uk", "ru"] : ["ru", "uk"];
  }
  return LATIN.test(word) ? ["en"] : [];
}

function keepCase(source: string, replacement: string) {
  if (source === source.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  const first = source[0] ?? "";
  if (first === first.toLocaleUpperCase()) {
    return `${replacement.slice(0, 1).toLocaleUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
}

function shouldIgnore(word: string) {
  const normalized = normalizedWord(word);
  return normalized.length < 2
    || CUSTOM_WORDS.has(normalized)
    || /^[\p{Lu}]{2,}$/u.test(word);
}

export function requiredSpellLanguages(text: string): SpellLanguage[] {
  const languages = new Set<SpellLanguage>();
  for (const match of text.matchAll(WORD_PATTERN)) {
    candidateLanguages(match[0], text).forEach((language) => languages.add(language));
  }
  return [...languages];
}

export function findSpellingIssues(
  text: string,
  checkers: Partial<Record<SpellLanguage, SpellChecker>>,
  limit = 8
): SpellcheckIssue[] {
  const issues: SpellcheckIssue[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0];
    const start = match.index ?? 0;
    if (shouldIgnore(word)) continue;

    const normalized = normalizedWord(word);
    const languages = candidateLanguages(word, text);
    if (languages.length === 0) continue;
    if (languages.some((language) => checkers[language]?.correct(normalized))) continue;

    const suggestions: string[] = [];
    for (const language of languages) {
      for (const suggestion of checkers[language]?.suggest(normalized) ?? []) {
        const cased = keepCase(word, suggestion);
        if (normalizedWord(cased) !== normalized && !suggestions.some((item) => normalizedWord(item) === normalizedWord(cased))) {
          suggestions.push(cased);
        }
        if (suggestions.length >= 3) break;
      }
      if (suggestions.length >= 3) break;
    }

    issues.push({
      id: `${start}:${word}`,
      word,
      start,
      end: start + word.length,
      language: languages[0],
      suggestions,
    });
    if (issues.length >= limit) break;
  }
  return issues;
}

export function replaceSpellingIssue(text: string, issue: SpellcheckIssue, replacement: string) {
  if (text.slice(issue.start, issue.end) !== issue.word) return text;
  return `${text.slice(0, issue.start)}${replacement}${text.slice(issue.end)}`;
}
