import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clearAccountDrafts,
  clearOtherAccountDrafts,
  draftScopeForAccount,
  FORM_DRAFT_STORAGE_PREFIX,
  FORM_DRAFT_TTL_MS,
  readFormDraft,
  writeFormDraft,
} from "../src/shared/utils/form-draft.ts";

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    keys: () => [...values.keys()],
  };
}

test("keeps company form drafts isolated between accounts", () => {
  const storage = memoryStorage();
  const first = draftScopeForAccount(10, "first@example.com");
  const second = draftScopeForAccount(11, "second@example.com");
  writeFormDraft(first, "company-create", { name: ["Private company A"] }, storage, 1_000);
  writeFormDraft(second, "company-create", { name: ["Private company B"] }, storage, 1_000);
  assert.equal(readFormDraft(first, "company-create", storage, 2_000)?.name[0], "Private company A");
  assert.equal(readFormDraft(second, "company-create", storage, 2_000)?.name[0], "Private company B");
  assert.notEqual(first, second);
});

test("expires drafts and removes stale company data", () => {
  const storage = memoryStorage();
  const scope = draftScopeForAccount(10, "first@example.com");
  writeFormDraft(scope, "contact-create", { email: ["private@example.com"] }, storage, 5_000);
  assert.ok(readFormDraft(scope, "contact-create", storage, 5_000 + FORM_DRAFT_TTL_MS - 1));
  assert.equal(readFormDraft(scope, "contact-create", storage, 5_000 + FORM_DRAFT_TTL_MS), null);
  assert.equal(storage.length, 0);
});

test("clears the current account on logout and other accounts on login", () => {
  const storage = memoryStorage();
  const first = draftScopeForAccount(10, "first@example.com");
  const second = draftScopeForAccount(11, "second@example.com");
  writeFormDraft(first, "task-create", { title: ["A"] }, storage);
  writeFormDraft(second, "task-create", { title: ["B"] }, storage);
  clearOtherAccountDrafts(second, storage);
  assert.equal(readFormDraft(first, "task-create", storage), null);
  assert.ok(readFormDraft(second, "task-create", storage));
  clearAccountDrafts(second, storage);
  assert.equal(storage.keys().filter((key) => key.startsWith(FORM_DRAFT_STORAGE_PREFIX)).length, 0);
});

test("wires protected drafts to every business-data form", async () => {
  const root = new URL("../", import.meta.url);
  const [app, hook, utility] = await Promise.all([
    readFile(new URL("src/app/CRMApp.tsx", root), "utf8"),
    readFile(new URL("src/shared/hooks/use-form-draft.tsx", root), "utf8"),
    readFile(new URL("src/shared/utils/form-draft.ts", root), "utf8"),
  ]);
  for (const draft of ["companyCreateDraft", "contactCreateDraft", "taskCreateDraft", "userCreateDraft", "profileDraft", "settingsDraft", "companyFormDraft", "contactFormDraft", "taskEditFormDraft", "userEditDraft", "lookupAddDraft"]) {
    assert.match(app, new RegExp(`<form[^>]*\\{\\.\\.\\.${draft}\\.formProps\\}`));
  }
  assert.match(app, /readFormDraft\(draftScope, "open-window"\)/);
  assert.match(app, /clearAccountDrafts\(draftScope\)/);
  assert.match(utility, /window\.sessionStorage/);
  assert.match(utility, /\["password", "file", "hidden", "submit", "button", "reset"\]/);
  assert.doesNotMatch(hook, /localStorage/);
});
