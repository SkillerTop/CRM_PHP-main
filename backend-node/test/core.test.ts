import { test } from "node:test";
import { strict as assert } from "node:assert";
import { hash } from "bcryptjs";
import argon2 from "argon2";
import { clientIp, equal, utc } from "../src/core.ts";
import { verifyPassword } from "../src/auth.ts";
import { pagination } from "../src/lookups.ts";

test("PHP database timestamps keep six fractional digits in API output", () => {
  assert.equal(
    utc("2026-11-11 07:30:12.123456"),
    "2026-11-11T07:30:12.123456Z",
  );
  assert.equal(utc(null), null);
});

test("session token comparison rejects changed values", () => {
  assert.equal(equal("abc", "abc"), true);
  assert.equal(equal("abc", "abd"), false);
  assert.equal(equal("abc", "abcd"), false);
});

test("proxy secret accepts only a single validated forwarded address", () => {
  const previous = process.env.PROXY_SHARED_SECRET;
  process.env.PROXY_SHARED_SECRET = "test-secret";
  try {
    const request = (forwarded: string) =>
      ({
        socket: { remoteAddress: "127.0.0.1" },
        headers: {
          "x-crm-proxy-secret": "test-secret",
          "x-forwarded-for": forwarded,
        },
      }) as Parameters<typeof clientIp>[0];
    assert.equal(clientIp(request("203.0.113.1")), "203.0.113.1");
    assert.equal(clientIp(request("203.0.113.1, 127.0.0.1")), "127.0.0.1");
  } finally {
    if (previous === undefined) delete process.env.PROXY_SHARED_SECRET;
    else process.env.PROXY_SHARED_SECRET = previous;
  }
});

test("legacy PHP password hash formats remain verifiable", async () => {
  const bcryptHash = await hash("secret", 4);
  const argonHash = await argon2.hash("secret", {
    timeCost: 1,
    memoryCost: 4096,
  });
  assert.equal(await verifyPassword("secret", bcryptHash), true);
  assert.equal(await verifyPassword("wrong", bcryptHash), false);
  assert.equal(await verifyPassword("secret", argonHash), true);
  assert.equal(await verifyPassword("wrong", argonHash), false);
});

test("pagination applies PHP defaults and bounds", () => {
  const page = pagination(
    new URL("http://localhost/api/lookups?page=3&per_page=500"),
  );
  assert.equal(page.offset, 200);
  assert.deepEqual(page.meta(205), {
    page: 3,
    per_page: 100,
    total: 205,
    pages: 3,
  });
});
