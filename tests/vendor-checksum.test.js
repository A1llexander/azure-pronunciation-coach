import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/* The vendored Speech SDK must match the SHA-256 recorded next to it (and in the README). */

const VENDOR = fileURLToPath(new URL("../vendor/", import.meta.url));

for (const dir of readdirSync(VENDOR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  test(`vendor/${dir.name} matches SHA256SUMS`, () => {
    const sums = readFileSync(join(VENDOR, dir.name, "SHA256SUMS"), "utf8").trim().split("\n");
    assert.ok(sums.length > 0);
    for (const line of sums) {
      const [expected, file] = line.trim().split(/\s+/);
      const actual = createHash("sha256").update(readFileSync(join(VENDOR, dir.name, file))).digest("hex");
      assert.equal(actual, expected, file);
    }
  });
}
