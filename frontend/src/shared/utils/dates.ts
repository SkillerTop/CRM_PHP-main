export function formatDateTime(value: string) {
  if (!value) return "—";
  return value.replace("T", " · ");
}

function kyivDateTimeParts(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
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

export function formatKyivDateTime(value: string) {
  const parts = kyivDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` : "";
}

export function formatKyivDateTimeInput(value: string) {
  const parts = kyivDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : "";
}

export function currentKyivStamp() {
  const parts = kyivDateTimeParts(new Date()) ?? { year: "0000", month: "00", day: "00", hour: "00", minute: "00" };
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function todayKyiv() {
  return currentKyivStamp().slice(0, 10);
}

export function kyivGreeting() {
  const hour = Number(currentKyivStamp().slice(11, 13));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
