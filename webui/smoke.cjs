// Bundle smoke test (Node 12 friendly, no JSDOM)
const fs = require("fs");
const path = require("path");
const code = fs.readFileSync(path.join(__dirname, "..", "pages", "avatar", "assets", "app.js"), "utf8");

console.log("Bundle size: " + code.length + " bytes");

// 1. parse as valid JS
try { new Function(code); console.log("OK [1/5] bundle parses as valid JS"); }
catch (e) { console.error("FAIL [1/5]: " + e.message); process.exit(1); }

// 2. no placeholders
for (const p of ["FIXME", "TODO", "XXX", "PLACEHOLDER"]) {
  if (code.includes(p)) { console.error("FAIL [2/5]: placeholder " + p); process.exit(1); }
}
console.log("OK [2/5] no placeholders left");

// 3. expected endpoint strings (the minifier inlines short identifier names
// like encodeKey, so we check stable tokens instead: the API path segments
// survive in template literals, and the URL helpers stay unminified).
for (const t of ['"avatars"', '"avatars/upload"', '"rotate"', '"state"', "encodeURIComponent", "data_url", "AstrBotPluginPage", "/crop", "/delete"]) {
  if (!code.includes(t)) { console.error("FAIL [3/5]: missing " + t); process.exit(1); }
}
console.log("OK [3/5] expected tokens present");

// 4. size sanity
if (code.length > 2 * 1024 * 1024) { console.error("FAIL [4/5]: too large " + code.length); process.exit(1); }
console.log("OK [4/5] size within budget");

// 5. no envelope anti-pattern
if (/\benv\.status\b/.test(code)) { console.error("FAIL [5/5]: env.status regression"); process.exit(1); }
console.log("OK [5/5] no env.status reference");

console.log("All smoke tests passed.");
