// Every piece of interface text must have a Chinese translation in web/i18n.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const I18N = require("../web/i18n.js");
const DEFAULT_RULES = require("../web/default-rules.js");

const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");
const zh = I18N.zh;
const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test("i18n: every data-i18n id in index.html has a Chinese entry", () => {
  const ids = [...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 40, "expected to find the page's data-i18n ids");
  assert.deepEqual(ids.filter(id => !(id in zh.ui)), []);
  const unused = Object.keys(zh.ui).filter(id => !ids.includes(id));
  assert.deepEqual(unused, [], "zh.ui entries no element uses");
});

test("i18n: every t(\"…\") string in index.html has a Chinese entry with the same {placeholders}", () => {
  const keys = new Set();
  for (const m of html.matchAll(/\bt\(([^;]*?)(?:,\s*\{|\)\s*[;,)}`+:?]|\)$)/gm))  // the text up to t(...)'s vars / end
    for (const s of m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${s[1]}"`));
  assert.ok(keys.size > 60, `expected to find the page's t() strings, found ${keys.size}`);
  assert.deepEqual([...keys].filter(k => !(k in zh.text)), []);
  for (const k of keys) assert.deepEqual(vars(zh.text[k]), vars(k), `placeholders differ for "${k}"`);
});

test("i18n: recurring cadence labels are translated", () => {
  for (const c of ["Weekly", "Every 2 weeks", "Monthly", "Every 3 months", "Yearly"]) {
    assert.ok(c in zh.text, c);
    assert.ok(fs.readFileSync(path.join(__dirname, "../web/engine.js"), "utf8").includes(`"${c}"`), `engine no longer uses "${c}"`);
  }
});

test("i18n: every default category has a Chinese name and description", () => {
  const cats = new Set([...DEFAULT_RULES.rules.map(r => r.category), ...Object.values(DEFAULT_RULES.category_aliases),
                        ...Object.keys(DEFAULT_RULES.category_info), "Uncategorized", "Income", "Transfers", "Ignored"]);
  assert.deepEqual([...cats].filter(c => !(c in zh.categories)), []);
  assert.deepEqual([...cats].filter(c => !(c in zh.categoryInfo)), []);
  const names = Object.values(zh.categories);
  assert.equal(new Set(names).size, names.length, "two categories share a Chinese name");
});
