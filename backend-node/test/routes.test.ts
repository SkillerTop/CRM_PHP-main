import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Node API registers every PHP route", () => {
  const root = resolve(import.meta.dirname, "../..");
  const php = readFileSync(
    resolve(root, "backend/src/Http/Routes.php"),
    "utf8",
  );
  const node = readFileSync(
    resolve(root, "backend-node/src/server.ts"),
    "utf8",
  );
  const reference = [...php.matchAll(/\$r->add\('([^']+)',\s*'([^']+)'/g)].map(
    (x) => `${x[1]} ${x[2]}`,
  );
  const port = [
    ...node.matchAll(
      /route(?:Params)?\(\s*['"]([^'"]+)['"],\s*['"]([^'"]+)['"]/g,
    ),
  ].map((x) => `${x[1]} ${x[2]}`);
  assert.deepEqual([...new Set(port)].sort(), [...new Set(reference)].sort());
});
