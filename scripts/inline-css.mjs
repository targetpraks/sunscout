import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const distDir = new URL("../dist", import.meta.url).pathname;
const htmlPath = join(distDir, "index.html");
let html = await readFile(htmlPath, "utf8");
const assetsDir = join(distDir, "assets");
const files = await readdir(assetsDir);
const cssFile = files.find((f) => f.endsWith(".css"));
if (!cssFile) process.exit(0);
const css = await readFile(join(assetsDir, cssFile), "utf8");
html = html.replace(
  /<link rel="stylesheet" crossorigin href="\/assets\/[^"]+\.css">/,
  `<style>${css}</style>`,
);
await writeFile(htmlPath, html);
console.log(`Inlined ${cssFile} (${css.length} bytes) into index.html`);
