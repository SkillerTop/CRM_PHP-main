const COOKIE_PREFIX = "crm_voice_draft_v1_";
const COOKIE_CHUNK_SIZE = 2800;
const MAX_COOKIE_CHUNKS = 16;
const SECURE_COOKIE_PREFIX = "crm_voice_draft_v2_";
const SECURE_KEY_PREFIX = "crm_voice_cookie_key_v2:";
const SECURE_COOKIE_TTL_SECONDS = 8 * 60 * 60;
const MAX_SECURE_COOKIE_CHUNKS = 6;

type CookieTarget = Pick<Document, "cookie">;
type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function cookieKey(key: string) {
  return `${COOKIE_PREFIX}${key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80)}`;
}

function cookieValues(cookieHeader: string) {
  return new Map(cookieHeader.split(";").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [part.trim(), ""] as const;
    return [part.slice(0, separator).trim(), part.slice(separator + 1)] as const;
  }).filter(([name]) => name !== ""));
}

function removeCookie(target: CookieTarget, name: string) {
  target.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function secureCookieAttributes(maxAge = SECURE_COOKIE_TTL_SECONDS) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  return `Path=/; Max-Age=${maxAge}; SameSite=Strict${secure}`;
}

function hashValue(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function secureCookieKey(scope: string, key: string) {
  const safeKey = key.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80);
  return `${SECURE_COOKIE_PREFIX}${hashValue(scope)}_${safeKey}`;
}

function keyStorageName(scope: string) {
  return `${SECURE_KEY_PREFIX}${hashValue(scope)}`;
}

function browserKeyStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.sessionStorage;
    const probe = `${SECURE_KEY_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle) throw new Error("Encrypted browser drafts are not supported in this browser.");
  return api;
}

async function encryptionKey(scope: string, storage: KeyStorage | null, create: boolean) {
  if (!scope || !storage) return null;
  const api = cryptoApi();
  const storageName = keyStorageName(scope);
  let encoded = storage.getItem(storageName);
  if (!encoded && create) {
    const raw = api.getRandomValues(new Uint8Array(32));
    encoded = toBase64Url(raw);
    storage.setItem(storageName, encoded);
  }
  if (!encoded) return null;
  return api.subtle.importKey("raw", fromBase64Url(encoded), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function secureCookiePayload(target: CookieTarget, name: string) {
  const values = cookieValues(target.cookie);
  const partCount = Number(values.get(`${name}_parts`) ?? "0");
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > MAX_SECURE_COOKIE_CHUNKS) return null;
  let encoded = "";
  for (let index = 0; index < partCount; index += 1) {
    const part = values.get(`${name}_${index}`);
    if (part === undefined) return null;
    encoded += part;
  }
  return encoded;
}

export function clearSecureVoiceDraft(scope: string, key: string, target: CookieTarget = document) {
  if (!scope) return;
  const name = secureCookieKey(scope, key);
  const values = cookieValues(target.cookie);
  const partCount = Math.min(MAX_SECURE_COOKIE_CHUNKS, Math.max(0, Number(values.get(`${name}_parts`) ?? "0") || 0));
  for (let index = 0; index < partCount; index += 1) {
    target.cookie = `${name}_${index}=; ${secureCookieAttributes(0)}`;
  }
  target.cookie = `${name}_parts=; ${secureCookieAttributes(0)}`;
}

export function clearAllSecureVoiceDrafts(target: CookieTarget = document, storage: KeyStorage | null = browserKeyStorage()) {
  const values = cookieValues(target.cookie);
  for (const name of values.keys()) {
    if (name.startsWith(SECURE_COOKIE_PREFIX)) target.cookie = `${name}=; ${secureCookieAttributes(0)}`;
  }
  if (!storage) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(SECURE_KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

export function clearOtherSecureVoiceDrafts(scope: string, target: CookieTarget = document, storage: KeyStorage | null = browserKeyStorage()) {
  if (!scope) return;
  const currentCookiePrefix = `${SECURE_COOKIE_PREFIX}${hashValue(scope)}_`;
  const values = cookieValues(target.cookie);
  for (const name of values.keys()) {
    if (name.startsWith(SECURE_COOKIE_PREFIX) && !name.startsWith(currentCookiePrefix)) {
      target.cookie = `${name}=; ${secureCookieAttributes(0)}`;
    }
  }
  if (!storage) return;
  const currentKey = keyStorageName(scope);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(SECURE_KEY_PREFIX) && key !== currentKey) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}

export async function writeSecureVoiceDraft(
  scope: string,
  key: string,
  value: string,
  target: CookieTarget = document,
  storage: KeyStorage | null = browserKeyStorage(),
  now = Date.now(),
) {
  if (!scope || !storage) return false;
  const api = cryptoApi();
  const secret = await encryptionKey(scope, storage, true);
  if (!secret) return false;
  const iv = api.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${scope}\0${key}`);
  const ciphertext = await api.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    secret,
    new TextEncoder().encode(value),
  );
  const encoded = encodeURIComponent(JSON.stringify({
    version: 2,
    expiresAt: now + SECURE_COOKIE_TTL_SECONDS * 1000,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  }));
  const chunks = Array.from(
    { length: Math.ceil(encoded.length / COOKIE_CHUNK_SIZE) },
    (_, index) => encoded.slice(index * COOKIE_CHUNK_SIZE, (index + 1) * COOKIE_CHUNK_SIZE),
  );
  if (chunks.length > MAX_SECURE_COOKIE_CHUNKS) return false;

  const name = secureCookieKey(scope, key);
  const previousValues = cookieValues(target.cookie);
  const previousPartCount = Math.min(MAX_SECURE_COOKIE_CHUNKS, Math.max(0, Number(previousValues.get(`${name}_parts`) ?? "0") || 0));
  chunks.forEach((chunk, index) => {
    target.cookie = `${name}_${index}=${chunk}; ${secureCookieAttributes()}`;
  });
  target.cookie = `${name}_parts=${chunks.length}; ${secureCookieAttributes()}`;
  for (let index = chunks.length; index < previousPartCount; index += 1) {
    target.cookie = `${name}_${index}=; ${secureCookieAttributes(0)}`;
  }
  return true;
}

export async function readSecureVoiceDraft(
  scope: string,
  key: string,
  target: CookieTarget = document,
  storage: KeyStorage | null = browserKeyStorage(),
  now = Date.now(),
) {
  if (!scope || !storage) return null;
  const name = secureCookieKey(scope, key);
  const encoded = secureCookiePayload(target, name);
  if (!encoded) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(encoded)) as {
      version?: unknown;
      expiresAt?: unknown;
      iv?: unknown;
      ciphertext?: unknown;
    };
    if (payload.version !== 2 || typeof payload.expiresAt !== "number" || payload.expiresAt <= now
      || typeof payload.iv !== "string" || typeof payload.ciphertext !== "string") {
      clearSecureVoiceDraft(scope, key, target);
      return null;
    }
    const secret = await encryptionKey(scope, storage, false);
    if (!secret) return null;
    const plaintext = await cryptoApi().subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(payload.iv), additionalData: new TextEncoder().encode(`${scope}\0${key}`) },
      secret,
      fromBase64Url(payload.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    clearSecureVoiceDraft(scope, key, target);
    return null;
  }
}

export function readVoiceDraft(key: string, cookieHeader = typeof document === "undefined" ? "" : document.cookie): string | null {
  const name = cookieKey(key);
  const values = cookieValues(cookieHeader);
  const partCount = Number(values.get(`${name}_parts`) ?? "0");
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > MAX_COOKIE_CHUNKS) return null;

  let encoded = "";
  for (let index = 0; index < partCount; index += 1) {
    const part = values.get(`${name}_${index}`);
    if (part === undefined) return null;
    encoded += part;
  }

  try {
    const payload = JSON.parse(decodeURIComponent(encoded)) as { value?: unknown };
    return typeof payload.value === "string" ? payload.value : null;
  } catch {
    return null;
  }
}

export function clearVoiceDraft(key: string, target: CookieTarget = document) {
  const name = cookieKey(key);
  const values = cookieValues(target.cookie);
  const partCount = Math.min(MAX_COOKIE_CHUNKS, Math.max(0, Number(values.get(`${name}_parts`) ?? "0") || 0));
  for (let index = 0; index < partCount; index += 1) removeCookie(target, `${name}_${index}`);
  removeCookie(target, `${name}_parts`);
}

export function clearAllVoiceDrafts(target: CookieTarget = document) {
  const values = cookieValues(target.cookie);
  for (const name of values.keys()) {
    if (name.startsWith(COOKIE_PREFIX)) removeCookie(target, name);
  }
}

export function writeVoiceDraft(key: string, value: string, target: CookieTarget = document) {
  const name = cookieKey(key);
  const previousValues = cookieValues(target.cookie);
  const previousPartCount = Math.min(MAX_COOKIE_CHUNKS, Math.max(0, Number(previousValues.get(`${name}_parts`) ?? "0") || 0));
  const encoded = encodeURIComponent(JSON.stringify({ value }));
  const chunks = Array.from({ length: Math.ceil(encoded.length / COOKIE_CHUNK_SIZE) }, (_, index) => encoded.slice(index * COOKIE_CHUNK_SIZE, (index + 1) * COOKIE_CHUNK_SIZE));
  if (chunks.length > MAX_COOKIE_CHUNKS) throw new Error("Voice draft is too large for browser cookies.");

  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  chunks.forEach((chunk, index) => {
    target.cookie = `${name}_${index}=${chunk}; Path=/; SameSite=Lax${secure}`;
  });
  target.cookie = `${name}_parts=${chunks.length}; Path=/; SameSite=Lax${secure}`;
  for (let index = chunks.length; index < previousPartCount; index += 1) removeCookie(target, `${name}_${index}`);
}

export const VOICE_DRAFT_COOKIE_CHUNK_SIZE = COOKIE_CHUNK_SIZE;
export const SECURE_VOICE_DRAFT_COOKIE_PREFIX = SECURE_COOKIE_PREFIX;
