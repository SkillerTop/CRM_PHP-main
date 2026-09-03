import nspell from "nspell";
import enAffUrl from "../../../node_modules/dictionary-en/index.aff?url";
import enDicUrl from "../../../node_modules/dictionary-en/index.dic?url";
import ruAffUrl from "../../../node_modules/dictionary-ru/index.aff?url";
import ruDicUrl from "../../../node_modules/dictionary-ru/index.dic?url";
import ukAffUrl from "../../../node_modules/dictionary-uk/index.aff?url";
import ukDicUrl from "../../../node_modules/dictionary-uk/index.dic?url";
import { findSpellingIssues, requiredSpellLanguages, type SpellChecker, type SpellLanguage } from "./spellcheck";

type SpellcheckRequest = { id: number; text: string };
type SpellcheckResponse = { id: number; issues?: ReturnType<typeof findSpellingIssues>; error?: string };

const dictionaryUrls: Record<SpellLanguage, { aff: string; dic: string }> = {
  en: { aff: enAffUrl, dic: enDicUrl },
  ru: { aff: ruAffUrl, dic: ruDicUrl },
  uk: { aff: ukAffUrl, dic: ukDicUrl },
};
const checkerPromises = new Map<SpellLanguage, Promise<SpellChecker>>();

async function fetchDictionaryFile(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Dictionary request failed with HTTP ${response.status}.`);
  return response.text();
}

function loadChecker(language: SpellLanguage) {
  const existing = checkerPromises.get(language);
  if (existing) return existing;
  const urls = dictionaryUrls[language];
  const promise = Promise.all([fetchDictionaryFile(urls.aff), fetchDictionaryFile(urls.dic)])
    .then(([aff, dic]) => nspell({ aff, dic }));
  checkerPromises.set(language, promise);
  return promise;
}

self.onmessage = async (event: MessageEvent<SpellcheckRequest>) => {
  const { id, text } = event.data;
  try {
    const languages = requiredSpellLanguages(text);
    const loaded = await Promise.all(languages.map(async (language) => [language, await loadChecker(language)] as const));
    const checkers = Object.fromEntries(loaded) as Partial<Record<SpellLanguage, SpellChecker>>;
    const response: SpellcheckResponse = { id, issues: findSpellingIssues(text, checkers) };
    self.postMessage(response);
  } catch (error) {
    const response: SpellcheckResponse = { id, error: error instanceof Error ? error.message : "Spellcheck failed." };
    self.postMessage(response);
  }
};
