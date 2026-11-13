import { test } from "node:test";
import { strict as assert } from "node:assert";

test("HTTP server exposes PHP-compatible JSON errors before database access", async () => {
  process.env.NODE_ENV = "test";
  const { server } = await import("../src/server.ts");
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP address");
    const origin = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(`${origin}/api/auth/me`);
    assert.equal(unauthorized.status, 401);
    assert.equal((await unauthorized.json()).error.code, "unauthenticated");
    const invalid = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, "validation_error");
    const frontend = await fetch(`${origin}/`);
    assert.match(
      frontend.headers.get("content-security-policy") ?? "",
      /script-src 'self'; connect-src 'self'/,
    );
    const missing = await fetch(`${origin}/api/health`, { method: "POST" });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "route_not_found");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
