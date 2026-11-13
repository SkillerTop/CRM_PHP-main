import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isPublicIp, safeGet } from "../src/safe-http.ts";

test("website lookup blocks local and reserved addresses before connecting", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "203.0.113.7",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("8.8.8.8"), true);
  await assert.rejects(safeGet("http://127.0.0.1/", 1024, ["text/html"]), {
    code: "lookup_blocked_address",
  });
  await assert.rejects(safeGet("http://localhost/", 1024, ["text/html"]), {
    code: "lookup_blocked_address",
  });
});
