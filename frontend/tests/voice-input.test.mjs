import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import nspell from "nspell";
import en from "dictionary-en";
import ru from "dictionary-ru";
import uk from "dictionary-uk";
import { findSpellingIssues, replaceSpellingIssue } from "../src/shared/utils/spellcheck.ts";
import {
  clearSecureVoiceDraft,
  clearVoiceDraft,
  readVoiceDraft,
  readSecureVoiceDraft,
  SECURE_VOICE_DRAFT_COOKIE_PREFIX,
  writeSecureVoiceDraft,
  writeVoiceDraft,
} from "../src/shared/utils/voice-draft.ts";
import {
  flushAndStopRecorder,
  isVoiceRecordingLongEnough,
  VOICE_AUDIO_TIMESLICE_MS,
  VOICE_MIN_RECORDING_MS,
  VOICE_RECORDING_LIMIT_MS,
} from "../src/shared/utils/voice-recording.ts";

function cookieJar() {
  const values = new Map();
  return {
    get cookie() {
      return [...values.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(serialized) {
      const [pair, ...attributes] = serialized.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (attributes.some((attribute) => attribute.toLowerCase() === "max-age=0")) values.delete(name);
      else values.set(name, value);
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

test("stores long multilingual voice drafts in chunked browser cookies", () => {
  const target = cookieJar();
  const draft = "Потрібно узгодити деталі з клієнтом. ".repeat(180);
  writeVoiceDraft("task-42-description", draft, target);
  assert.equal(readVoiceDraft("task-42-description", target.cookie), draft);
  assert.match(target.cookie, /crm_voice_draft_v1_task-42-description_parts=/);

  clearVoiceDraft("task-42-description", target);
  assert.equal(readVoiceDraft("task-42-description", target.cookie), null);
});

test("keeps an intentionally empty draft distinct from a missing draft", () => {
  const target = cookieJar();
  writeVoiceDraft("company-7-description", "", target);
  assert.equal(readVoiceDraft("company-7-description", target.cookie), "");
});

test("stores voice drafts in encrypted account-scoped cookies", async () => {
  const target = cookieJar();
  const storage = memoryStorage();
  const text = "Конфиденциальные детали компании и следующий шаг.";
  assert.equal(await writeSecureVoiceDraft("account-42", "voice:task-comment", text, target, storage, 1_000), true);
  assert.match(target.cookie, new RegExp(SECURE_VOICE_DRAFT_COOKIE_PREFIX));
  assert.doesNotMatch(target.cookie, /Конфиденциальные|%D0%9A%D0%BE%D0%BD/);
  assert.equal(await readSecureVoiceDraft("account-42", "voice:task-comment", target, storage, 2_000), text);
  assert.equal(await readSecureVoiceDraft("account-43", "voice:task-comment", target, storage, 2_000), null);
  clearSecureVoiceDraft("account-42", "voice:task-comment", target);
  assert.equal(await readSecureVoiceDraft("account-42", "voice:task-comment", target, storage, 2_000), null);
});

test("finds and replaces spelling errors in Ukrainian, Russian, and English text", () => {
  const checkers = { en: nspell(en), ru: nspell(ru), uk: nspell(uk) };
  const text = "Нужно соглосовать детали. Треба узгодити документи. Pleese confirm.";
  const issues = findSpellingIssues(text, checkers);
  assert.ok(issues.some((issue) => issue.word === "соглосовать" && issue.suggestions.includes("согласовать")));
  assert.ok(issues.some((issue) => issue.word === "Pleese" && issue.suggestions.includes("Please")));
  assert.ok(!issues.some((issue) => issue.word === "узгодити"));
  const issue = issues.find((candidate) => candidate.word === "соглосовать");
  assert.ok(issue);
  assert.match(replaceSpellingIssue(text, issue, "согласовать"), /Нужно согласовать детали/);
});

test("flushes pending MediaRecorder data before stopping", () => {
  const calls = [];
  flushAndStopRecorder({
    requestData: () => calls.push("requestData"),
    stop: () => calls.push("stop"),
  });
  assert.deepEqual(calls, ["requestData", "stop"]);

  const fallbackCalls = [];
  flushAndStopRecorder({
    requestData: () => { throw new DOMException("Already stopping", "InvalidStateError"); },
    stop: () => fallbackCalls.push("stop"),
  });
  assert.deepEqual(fallbackCalls, ["stop"]);
});

test("rejects sub-second recordings before transcription", () => {
  assert.equal(VOICE_MIN_RECORDING_MS, 1_000);
  assert.equal(isVoiceRecordingLongEnough(999), false);
  assert.equal(isVoiceRecordingLongEnough(1_000), true);
});

test("caps microphone recording at one minute and wires all voice draft fields", async () => {
  const root = new URL("../", import.meta.url);
  const [voice, app, draftHook] = await Promise.all([
    readFile(new URL("src/shared/components/voice-input.tsx", root), "utf8"),
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/shared/hooks/use-cookie-draft.ts", root), "utf8"),
  ]);
  assert.equal(VOICE_RECORDING_LIMIT_MS, 60_000);
  assert.equal(VOICE_AUDIO_TIMESLICE_MS, 250);
  assert.match(voice, /window\.setTimeout\(stop, VOICE_RECORDING_LIMIT_MS\)/);
  assert.match(voice, /recorder\.start\(VOICE_AUDIO_TIMESLICE_MS\)/);
  assert.match(voice, /recorder\.onstop = \(\) => \{[\s\S]*?releaseMicrophone\(\)/);
  const stopFunction = voice.slice(voice.indexOf("function stop()"), voice.indexOf("async function start()"));
  assert.ok(stopFunction.indexOf("flushAndStopRecorder(recorder)") < stopFunction.indexOf("releaseMicrophone()"));
  assert.match(voice, /body\.append\("duration_seconds"/);
  assert.match(voice, /import\.meta\.env\.DEV[\s\S]*window\.location\.hostname}:8080/);
  assert.match(voice, /apiRequest<\{ data: \{ text: string \} \}>\([\s\S]*speechBackendUrl/);
  assert.match(voice, /checkSpelling\(value\)/);
  assert.match(voice, /className={`spellcheck-panel/);
  assert.match(voice, /replaceSpellingIssue\(value, issue, suggestion\)/);
  assert.match(draftHook, /readSecureVoiceDraft\(scope, secureKey\)/);
  assert.match(draftHook, /writeSecureVoiceDraft\(scope, secureKey, draft\.value\)/);
  assert.ok((app.match(/<VoiceTextTools\b/g) ?? []).length >= 5);
  assert.doesNotMatch(app, /AI_INPUTS_ENABLED/);
});

test("keeps voice and spelling controls usable on phone screens", async () => {
  const root = new URL("../", import.meta.url);
  const [voice, css] = await Promise.all([
    readFile(new URL("src/shared/components/voice-input.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);

  assert.match(voice, /className="spellcheck-source"/);
  assert.match(voice, /className="spellcheck-suggestions"/);
  assert.match(css, /\.voice-text-tools\s*\{[^}]*display:\s*grid[^}]*max-width:\s*100%/s);
  assert.match(css, /\.voice-input\s*>\s*button\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media \(max-width:\s*700px\)\s*\{[\s\S]*?\.voice-input\s*>\s*button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*48px/s);
  assert.match(css, /@media \(max-width:\s*700px\)\s*\{[\s\S]*?\.spellcheck-suggestions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(max-width:\s*390px\)\s*\{\s*\.spellcheck-suggestions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.spellcheck-suggestions\s*>\s*button\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
});
