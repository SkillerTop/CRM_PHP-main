import { DateTime } from "luxon";
import type { Row } from "./core.js";

const escape = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
const format = (date: DateTime): string =>
  date.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
export function taskCalendar(task: Row): string {
  const deadline = DateTime.fromSQL(String(task.deadline), { zone: "UTC" });
  let host = "crm.local";
  try {
    host = new URL(process.env.APP_URL ?? "https://crm.local").hostname || host;
  } catch {}
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CJN//Client Data CRM//UK",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:task-${task.id}@${host}`,
    `DTSTAMP:${format(DateTime.utc())}`,
    `DTSTART:${format(deadline)}`,
    `DTEND:${format(deadline.plus({ minutes: 30 }))}`,
    `SUMMARY:${escape(`CRM deadline: ${task.name}`)}`,
    `DESCRIPTION:${escape(`${task.company_name ?? ""} · ${task.manager_value ?? ""}\n${task.description ?? ""}`)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escape(String(task.name))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
