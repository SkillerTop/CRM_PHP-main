export function formatDateTime(value: string) {
  if (!value) return "—";
  return value.replace("T", " · ");
}

export const DEFAULT_TIME_ZONE = "Europe/Kyiv";

const TIME_ZONE_ALIASES: Record<string, string> = {
  "Europe/Kiev": DEFAULT_TIME_ZONE,
};

export function getBrowserTimeZone() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIME_ZONE_ALIASES[detected] ?? detected ?? DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function userDateTimeParts(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: getBrowserTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export function formatUserDateTime(value: string) {
  const parts = userDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` : "";
}

export function formatUserDateTimeInput(value: string) {
  const parts = userDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : "";
}

export function currentUserStamp() {
  const parts = userDateTimeParts(new Date()) ?? { year: "0000", month: "00", day: "00", hour: "00", minute: "00" };
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function todayUser() {
  return currentUserStamp().slice(0, 10);
}

export function userGreeting() {
  const hour = Number(currentUserStamp().slice(11, 13));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function localDateTimeToUtc(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function isLocalDateTimePast(value: string) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return !Number.isNaN(timestamp) && timestamp < Date.now();
}
