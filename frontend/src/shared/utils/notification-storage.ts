export type ReadNotificationIdsByAccount = Record<string, string[]>;

export const READ_NOTIFICATIONS_STORAGE_KEY = "client-data-crm.read-notifications.v1";

const MAX_STORED_ACCOUNTS = 20;
const MAX_STORED_IDS_PER_ACCOUNT = 500;
const MAX_NOTIFICATION_ID_LENGTH = 512;

type ReadStorage = { getItem: (key: string) => string | null };
type WriteStorage = { setItem: (key: string, value: string) => void };

function browserStorage(): (ReadStorage & WriteStorage) | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeReadNotificationIds(value: unknown): ReadNotificationIdsByAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([accountKey, ids]) => accountKey.length > 0 && accountKey.length <= 160 && Array.isArray(ids))
    .slice(-MAX_STORED_ACCOUNTS);

  return Object.fromEntries(entries.map(([accountKey, ids]) => [
    accountKey,
    Array.from(new Set((ids as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_NOTIFICATION_ID_LENGTH))).slice(-MAX_STORED_IDS_PER_ACCOUNT),
  ]));
}

export function loadReadNotificationIds(storage: ReadStorage | null = browserStorage()): ReadNotificationIdsByAccount {
  if (!storage) return {};
  try {
    const stored = storage.getItem(READ_NOTIFICATIONS_STORAGE_KEY);
    return stored ? normalizeReadNotificationIds(JSON.parse(stored)) : {};
  } catch {
    return {};
  }
}

export function saveReadNotificationIds(value: ReadNotificationIdsByAccount, storage: WriteStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(READ_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(normalizeReadNotificationIds(value)));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function updateReadNotificationAccount(
  current: ReadNotificationIdsByAccount,
  accountKey: string,
  ids: string[],
): ReadNotificationIdsByAccount {
  if (!accountKey) return current;
  const next = { ...current };
  delete next[accountKey];
  next[accountKey] = ids;
  return normalizeReadNotificationIds(next);
}
