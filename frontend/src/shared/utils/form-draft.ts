const STORAGE_PREFIX = "crm_private_draft_v1:";
export const FORM_DRAFT_TTL_MS = 8 * 60 * 60 * 1000;

export type DraftFields = Record<string, string[]>;

type DraftEnvelope = {
  version: 1;
  expiresAt: number;
  fields: DraftFields;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function hashAccount(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function draftScopeForAccount(id: number | undefined, accountEmail: string) {
  return `account-${id ?? "email"}-${hashAccount(accountEmail.trim().toLowerCase())}`;
}

function storageKey(scope: string, key: string) {
  const safeScope = scope.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  const safeKey = key.replace(/[^a-z0-9:_-]/gi, "_").slice(0, 160);
  return `${STORAGE_PREFIX}${safeScope}:${safeKey}`;
}

export function browserDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    const probe = `${STORAGE_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function readFormDraft(scope: string, key: string, storage: DraftStorage | null = browserDraftStorage(), now = Date.now()): DraftFields | null {
  if (!scope || !storage) return null;
  const target = storageKey(scope, key);
  const serialized = storage.getItem(target);
  if (!serialized) return null;
  try {
    const envelope = JSON.parse(serialized) as Partial<DraftEnvelope>;
    if (envelope.version !== 1 || typeof envelope.expiresAt !== "number" || envelope.expiresAt <= now || !envelope.fields || typeof envelope.fields !== "object") {
      storage.removeItem(target);
      return null;
    }
    const fields: DraftFields = {};
    for (const [name, values] of Object.entries(envelope.fields)) {
      if (Array.isArray(values) && values.every((value) => typeof value === "string")) fields[name] = values;
    }
    return fields;
  } catch {
    storage.removeItem(target);
    return null;
  }
}

export function writeFormDraft(scope: string, key: string, fields: DraftFields, storage: DraftStorage | null = browserDraftStorage(), now = Date.now()) {
  if (!scope || !storage) return;
  const envelope: DraftEnvelope = { version: 1, expiresAt: now + FORM_DRAFT_TTL_MS, fields };
  storage.setItem(storageKey(scope, key), JSON.stringify(envelope));
}

export function clearFormDraft(scope: string, key: string, storage: DraftStorage | null = browserDraftStorage()) {
  if (!scope || !storage) return;
  storage.removeItem(storageKey(scope, key));
}

export function clearAccountDrafts(scope: string, storage: DraftStorage | null = browserDraftStorage()) {
  if (!scope || !storage) return;
  const prefix = storageKey(scope, "");
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

export function clearOtherAccountDrafts(scope: string, storage: DraftStorage | null = browserDraftStorage()) {
  if (!scope || !storage) return;
  const currentPrefix = storageKey(scope, "");
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX) && key !== `${STORAGE_PREFIX}probe` && !key.startsWith(currentPrefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

export function formFields(form: HTMLFormElement): DraftFields {
  const fields: DraftFields = {};
  const controls = Array.from(form.elements).filter((item): item is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
    item instanceof HTMLInputElement || item instanceof HTMLSelectElement || item instanceof HTMLTextAreaElement,
  );
  for (const control of controls) {
    const name = control.name;
    if (!name || control.disabled || control.dataset.draftExclude === "true") continue;
    if (control instanceof HTMLInputElement && ["password", "file", "hidden", "submit", "button", "reset"].includes(control.type)) continue;
    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
      if (control.checked) (fields[name] ??= []).push(control.value);
      else fields[name] ??= [];
      continue;
    }
    if (control instanceof HTMLSelectElement && control.multiple) {
      fields[name] = Array.from(control.selectedOptions, (option) => option.value);
      continue;
    }
    fields[name] = [control.value];
  }
  return fields;
}

export const FORM_DRAFT_STORAGE_PREFIX = STORAGE_PREFIX;
