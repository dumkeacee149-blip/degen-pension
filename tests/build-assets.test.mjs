import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import viteConfig from "../vite.config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientRoot = path.join(root, "dist", "client");

test("development keeps the public asset directory mounted", () => {
  const serve = viteConfig({ command: "serve", mode: "development" });
  const build = viteConfig({ command: "build", mode: "production" });
  assert.equal(serve.publicDir, "public");
  assert.equal(build.publicDir, false);
});

test("serverless durations and source-upload exclusions match the runtime budget", async () => {
  const vercel = JSON.parse(await readFile(path.join(root, "vercel.json"), "utf8"));
  assert.equal(vercel.functions["api/quote.js"].maxDuration, 30);
  assert.equal(vercel.functions["api/runtime.js"].maxDuration, 30);
  assert.equal(vercel.functions["api/holder-stock.js"].maxDuration, 30);
  assert.equal(vercel.functions["api/eligibility.js"].maxDuration, 15);

  const ignored = await readFile(path.join(root, ".vercelignore"), "utf8");
  assert.match(ignored, /^public\/assets\/social\/$/m);
  assert.match(ignored, /^public\/assets\/\*\.png$/m);
});

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(absolute));
    else output.push(absolute);
  }
  return output;
}

test("production client contains only the runtime public asset set", async () => {
  const files = await filesUnder(clientRoot);
  const relative = files.map((file) => path.relative(clientRoot, file));
  assert.equal(relative.some((file) => file.startsWith("assets/social/")), false);
  assert.equal(relative.includes("assets/raccoon-deadpan-v2.png"), false);
  assert.equal(relative.includes("assets/raccoon-deadpan-v2.webp"), true);
  assert.equal(relative.includes("social/og-99-1.png"), true);

  let totalBytes = 0;
  for (const file of files) totalBytes += (await stat(file)).size;
  assert.ok(totalBytes < 3_000_000, `dist/client is unexpectedly large: ${totalBytes} bytes`);
});
