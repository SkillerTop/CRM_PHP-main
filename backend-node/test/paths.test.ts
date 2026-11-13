import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { backendRoot } from "../src/paths.js";
import { uploadRoot } from "../src/storage.js";

test("upload storage resolves from the backend directory independently of cwd", () => {
  const previous = process.cwd();
  const configured = process.env.UPLOAD_DIR;
  try {
    delete process.env.UPLOAD_DIR;
    process.chdir(backendRoot);
    assert.equal(uploadRoot(), join(backendRoot, "storage", "uploads"));
  } finally {
    process.chdir(previous);
    if (configured === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = configured;
  }
});
