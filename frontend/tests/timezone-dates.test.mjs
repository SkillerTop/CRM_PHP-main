import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const datesModuleUrl = new URL("../src/shared/utils/dates.ts", import.meta.url).href;

function runInTimeZone(timeZone, expression) {
  const source = `import(${JSON.stringify(datesModuleUrl)}).then((dates) => process.stdout.write(JSON.stringify(${expression})))`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    env: { ...process.env, TZ: timeZone },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("detects the browser timezone and round-trips a local deadline through UTC", () => {
  const result = runInTimeZone("America/New_York", `({
    zone: dates.getBrowserTimeZone(),
    input: dates.formatUserDateTimeInput("2026-08-26T13:00:00.000Z"),
    utc: dates.localDateTimeToUtc("2026-08-26T09:00"),
  })`);

  assert.deepEqual(result, {
    zone: "America/New_York",
    input: "2026-08-26T09:00",
    utc: "2026-08-26T13:00:00.000Z",
  });
});

test("keeps Europe/Kyiv as the standard timezone while respecting summer offset", () => {
  const result = runInTimeZone("Europe/Kyiv", `({
    zone: dates.getBrowserTimeZone(),
    input: dates.formatUserDateTimeInput("2026-08-26T10:00:00.000Z"),
    utc: dates.localDateTimeToUtc("2026-08-26T13:00"),
  })`);

  assert.deepEqual(result, {
    zone: "Europe/Kyiv",
    input: "2026-08-26T13:00",
    utc: "2026-08-26T10:00:00.000Z",
  });
});

test("derives a city-only label for timezone displays outside the workspace chrome", () => {
  const result = runInTimeZone("Europe/Warsaw", `({
    warsaw: dates.timeZoneCityLabel(dates.getBrowserTimeZone()),
    newYork: dates.timeZoneCityLabel("America/New_York"),
    kyiv: dates.timeZoneCityLabel("Europe/Kyiv"),
  })`);

  assert.deepEqual(result, {
    warsaw: "Warsaw",
    newYork: "New York",
    kyiv: "Kyiv",
  });
});

test("formats the ISO week number and calendar quarter for the page date", () => {
  const result = runInTimeZone("Europe/Kyiv", `({
    august: dates.userWeekQuarter("2026-08-26"),
    january: dates.userWeekQuarter("2026-01-01"),
  })`);

  assert.deepEqual(result, {
    august: "Wk35 · Q3",
    january: "Wk1 · Q1",
  });
});

test("wires local deadlines to UTC API payloads and exposes a non-default timezone", async () => {
  const app = await readFile(new URL("../src/app/CRMApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const CLIENT_TIME_ZONE = getBrowserTimeZone\(\)/);
  assert.match(app, /deadline: localDateTimeToUtc\(task\.deadline\)/);
  assert.match(app, /\{userWeekQuarter\(\)\} · \{todayUser\(\)\} · \{CLIENT_TIME_ZONE_LABEL\}/);
  assert.match(app, /<b>Workspace ready<\/b><small>\{CLIENT_TIME_ZONE_LABEL\}<\/small>/);
  assert.match(app, /const CLIENT_TIME_ZONE_LABEL = timeZoneCityLabel\(CLIENT_TIME_ZONE\)/);
  assert.match(app, /CLIENT_TIME_ZONE_IS_DEFAULT \? "" : ` · \$\{CLIENT_TIME_ZONE_LABEL\}`/);
  assert.match(app, /value=\{CLIENT_TIME_ZONE_LABEL\} readOnly/);
  assert.match(app, /<th>Time · \{CLIENT_TIME_ZONE_LABEL\}<\/th>/);
  assert.doesNotMatch(app, /Deadline · \{CLIENT_TIME_ZONE\}/);
});

test("keeps the Relationship Board implementation while removing every route to it", async () => {
  const [app, routes] = await Promise.all([
    readFile(new URL("../src/app/CRMApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../backend/src/Http/Routes.php", import.meta.url), "utf8"),
  ]);
  assert.match(app, /function Pipeline\(/);
  assert.doesNotMatch(app, /\| "pipeline"|ALL_VIEWS[^\n]*"pipeline"|view === "pipeline"|navigate\("pipeline"\)|Open board/);
  assert.match(app, /const navPrimary: View\[\] = \["dashboard", "companies", "contacts", "activity"\]/);
  assert.doesNotMatch(routes, /add\('GET', '\/api\/pipeline'/);
});
