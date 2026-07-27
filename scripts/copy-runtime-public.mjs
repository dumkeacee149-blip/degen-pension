#!/usr/bin/env node
import {
  copyFileSync,
  mkdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(root, "public");
const outputRoot = path.join(root, "dist", "client");

const runtimeFiles = [
  "assets/badge-401kek-v1.webp",
  "assets/badge-qqq-v1.webp",
  "assets/paper-texture-v2.webp",
  "assets/raccoon-deadpan-v2.webp",
  "assets/raccoon-ledger-v1.webp",
  "assets/raccoon-overtime-v1.webp",
  "assets/raccoon-reluctant-celebration-v1.webp",
  "assets/raccoon-watch-chart-v1.webp",
  "brand/mark-99-1-v2.webp",
  "brand/mark-99-1.png",
  "social/og-99-1.png",
];

let copiedBytes = 0;
for (const relativePath of runtimeFiles) {
  const source = path.join(publicRoot, relativePath);
  const destination = path.join(outputRoot, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  copiedBytes += statSync(source).size;
}

console.log(`Copied ${runtimeFiles.length} runtime public files (${copiedBytes} bytes).`);
