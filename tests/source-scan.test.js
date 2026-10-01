import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Repository-wide scan backing the acceptance criterion:
 * "A search of the code finds no innerHTML, insertAdjacentHTML or eval".
 * ESLint covers JS syntax; this test also covers HTML files and inline scripts,
 * which the CSP (script-src 'self', no 'unsafe-inline') would block anyway.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "tests"]);
const SKIP_FILES = new Set(["eslint.config.js"]);

// Built from parts so this file does not match its own patterns.
const SINKS = [["inner", "HTML"], ["outer", "HTML"], ["insertAdjacent", "HTML"]].map((p) => p.join(""));
const SINK_RE = new RegExp(`\\b(${SINKS.join("|")})\\b`);
const EVAL_RE = new RegExp(["\\bev", "al\\s*\\("].join(""));
const NEW_FUNCTION_RE = new RegExp(["new\\s+Func", "tion\\s*\\("].join(""));
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>/i;
const INLINE_HANDLER_RE = /<[^>]+\son[a-z]+\s*=/i;

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(join(dir, entry.name)));
    } else if (/\.(js|html)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = listFiles(ROOT);

test("finds source files to scan", () => {
  assert.ok(files.length > 0);
});

test("no HTML string sinks or dynamic code evaluation in source", () => {
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of [SINK_RE, EVAL_RE, NEW_FUNCTION_RE]) {
      if (re.test(text)) offenders.push(`${relative(ROOT, file)}: ${re}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("HTML files have no inline scripts or inline event handlers", () => {
  const offenders = [];
  for (const file of files.filter((f) => f.endsWith(".html"))) {
    const text = readFileSync(file, "utf8");
    if (INLINE_SCRIPT_RE.test(text)) offenders.push(`${relative(ROOT, file)}: inline <script>`);
    if (INLINE_HANDLER_RE.test(text)) offenders.push(`${relative(ROOT, file)}: inline on* handler`);
  }
  assert.deepEqual(offenders, []);
});
