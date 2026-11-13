import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

test("Compose routes production traffic and scheduler to Node.js", () => {
  const root = resolve(import.meta.dirname, "../..");
  const compose = parseDocument(
    readFileSync(resolve(root, "compose.yaml"), "utf8"),
  );
  const override = parseDocument(
    readFileSync(resolve(root, "compose.override.yaml"), "utf8"),
  );
  assert.deepEqual(compose.errors, []);
  assert.deepEqual(override.errors, []);
  const services = (compose.toJS() as { services: Record<string, any> })
    .services;
  assert.ok(services.app.ports.some((port: string) => port.endsWith(":8080")));
  assert.ok(
    services.app.healthcheck.test.includes("http://127.0.0.1:8080/api/health"),
  );
  assert.match(
    services.scheduler.command.join(" "),
    /node dist\/cli\.js reminders:run/,
  );
  assert.match(
    readFileSync(resolve(root, "deploy/docker/Caddyfile"), "utf8"),
    /reverse_proxy app:8080/,
  );
});
