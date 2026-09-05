// Build script: esbuild 打包 React 源码到 ../pages/avatar/
// CommonJS 兼容 Node 12 + Windows
const { build } = require("esbuild");
const { mkdir, copyFile } = require("fs").promises;
const { existsSync } = require("fs");
const path = require("path");

const webui = __dirname;
const outDir = path.resolve(webui, "../pages/avatar");

async function copyIfExists(src, dest) {
  if (existsSync(src)) await copyFile(src, dest);
}

async function run() {
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, "assets"), { recursive: true });

  await build({
    entryPoints: [path.join(webui, "src/main.tsx")],
    bundle: true,
    outfile: path.join(outDir, "assets/app.js"),
    format: "iife",
    target: ["es2019"],
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    loader: { ".svg": "text", ".png": "file", ".css": "css" },
    logLevel: "warning",
  });

  await copyIfExists(path.join(webui, "src/index.html"), path.join(outDir, "index.html"));
  await copyIfExists(path.join(webui, "src/_page.json"), path.join(outDir, "_page.json"));

  console.log("Build done -> " + outDir);
}

run().catch((e) => { console.error(e); process.exit(1); });
