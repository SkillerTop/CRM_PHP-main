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

test("wires local deadlines to UTC API payloads and exposes a non-default timezone", async () => {
  const app = await readFile(new URL("../src/app/CRMApp.tsx", import.meta.url), "utf8");
  assert.match(app, /const CLIENT_TIME_ZONE = getBrowserTimeZone\(\)/);
  assert.match(app, /deadline: localDateTimeToUtc\(task\.deadline\)/);
  assert.match(app, /CLIENT_TIME_ZONE_IS_DEFAULT \? "" : ` · \$\{CLIENT_TIME_ZONE\}`/);
  assert.match(app, /value=\{CLIENT_TIME_ZONE\} readOnly/);
});
