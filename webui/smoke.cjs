// Bundle smoke test (Node 12 friendly, no JSDOM)
const fs = require("fs");
const path = require("path");
const base = path.join(__dirname, "..", "pages", "avatar");
const code = fs.readFileSync(path.join(base, "assets/app.js"), "utf8");
const css = fs.existsSync(path.join(base, "assets/app.css")) ? fs.readFileSync(path.join(base, "assets/app.css"), "utf8") : "";
const html = fs.readFileSync(path.join(base, "index.html"), "utf8");

console.log("Bundle size: " + code.length + " bytes (css: " + css.length + ")");

// 1. parse as valid JS
try { new Function(code); console.log("OK [1/7] bundle parses as valid JS"); }
catch (e) { console.error("FAIL [1/7]: " + e.message); process.exit(1); }

// 2. no placeholders
for (const p of ["FIXME", "TODO", "XXX", "PLACEHOLDER"]) {
  if (code.includes(p) || css.includes(p)) { console.error("FAIL [2/7]: placeholder " + p); process.exit(1); }
}
console.log("OK [2/7] no placeholders left");

// 3. expected endpoint strings
for (const t of ['"avatars"', '"avatars/upload"', '"rotate"', '"state"', "encodeURIComponent", "data_url", "AstrBotPluginPage", "/crop", "/delete"]) {
  if (!code.includes(t)) { console.error("FAIL [3/7]: missing " + t); process.exit(1); }
}
console.log("OK [3/7] expected tokens present");

// 4. size sanity
if (code.length > 2 * 1024 * 1024) { console.error("FAIL [4/7]: too large " + code.length); process.exit(1); }
console.log("OK [4/7] size within budget");

// 5. no envelope anti-pattern
if (/\benv\.status\b/.test(code)) { console.error("FAIL [5/7]: env.status regression"); process.exit(1); }
console.log("OK [5/7] no env.status reference");

// 6. two-stage LQIP loading markers:
//  - JS: size constants, the /image template literal, decoding=async hint
//  - CSS: blur + skeleton shimmer classes
const jsMarkers = ["qg-img-preview", "qg-img-sharp", "192", "1024", "decoding", "avatars/${", "/image`"];
const cssMarkers = ["qg-img-preview", "qg-img-sharp", "blur(20px)", "qg-img-skel", "qg-skel-shimmer"];
let missingJs = jsMarkers.filter((m) => !code.includes(m));
let missingCss = cssMarkers.filter((m) => !css.includes(m));
if (missingJs.length) { console.error("FAIL [6/7] JS missing " + missingJs.join(",")); process.exit(1); }
if (missingCss.length) { console.error("FAIL [6/7] CSS missing " + missingCss.join(",")); process.exit(1); }
console.log("OK [6/7] LQIP markers present (JS + CSS)");

// 7. CSS link in HTML
if (!html.includes('rel="stylesheet"') || !html.includes("app.css")) { console.error("FAIL [7/7]: CSS link missing in index.html"); process.exit(1); }
console.log("OK [7/7] CSS link in index.html");

console.log("All smoke tests passed.");

console.log("All smoke tests passed.");
