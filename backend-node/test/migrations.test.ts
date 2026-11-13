import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { splitSql } from "../src/migrations.ts";

test("migration parser preserves semicolons in values and all reference migrations", () => {
  assert.deepEqual(
    splitSql("-- note\nINSERT INTO x VALUES ('a;b');\nSELECT \"x;y\";"),
    ["INSERT INTO x VALUES ('a;b')", 'SELECT "x;y"'],
  );
  const root = resolve(
    import.meta.dirname,
    "../../backend/database/migrations",
  );
  for (let version = 1; version <= 13; version++) {
    const file = readdirSync(root).find((name) =>
      name.startsWith(String(version).padStart(3, "0")),
    );
    assert.ok(file, `migration ${version}`);
    const statements = splitSql(readFileSync(resolve(root, file), "utf8"));
    assert.ok(statements.length > 0, `${file} has SQL`);
  }
});
