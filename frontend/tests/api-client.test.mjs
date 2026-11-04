import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiRequest, loadAllPages } from "../src/shared/api/api-client.ts";

test("API timeout aborts a stalled request and reports a recoverable error", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      aborted = true;
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
  try {
    await assert.rejects(apiRequest("/slow", {}, "", 10), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "request_timeout");
      assert.equal(error.status, 408);
      return true;
    });
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful requests preserve caller abort and CSRF handling", async () => {
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (url, init) => {
    received = { url, init };
    return new Response(JSON.stringify({ data: { ok: true } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const controller = new AbortController();
    const response = await apiRequest("/test", { method: "POST", body: JSON.stringify({ x: 1 }), signal: controller.signal }, "", 100);
    assert.deepEqual(response, { data: { ok: true } });
    assert.equal(received.url, "/api/test");
    assert.equal(received.init.headers.get("content-type"), "application/json");
    assert.equal(received.init.credentials, "same-origin");
    assert.equal(received.init.signal.aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("paged records load in bounded parallel batches and retain server order", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let peak = 0;
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url, "http://localhost").searchParams.get("page"));
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return new Response(JSON.stringify({ data: [page], meta: { pages: 8 } }), { headers: { "content-type": "application/json" } });
  };
  try {
    const records = await loadAllPages("/companies", "name", "asc");
    assert.deepEqual(records, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(peak, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
