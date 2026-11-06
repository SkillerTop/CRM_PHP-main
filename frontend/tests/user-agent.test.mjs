import assert from "node:assert/strict";
import test from "node:test";
import { describeUserAgent } from "../src/shared/utils/user-agent.ts";

test("describes session devices from the User-Agent header", () => {
  assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"), "Chrome · Windows");
  assert.equal(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0"), "Edge · Windows");
  assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari · iOS");
  assert.equal(describeUserAgent("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"), "Chrome · Android");
  assert.equal(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0"), "Firefox · macOS");
  assert.equal(describeUserAgent("curl/8.5.0"), "Other device");
  assert.equal(describeUserAgent(null), "Unknown device");
});
