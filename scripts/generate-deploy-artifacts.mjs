import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = resolve(
  projectRoot,
  "contracts/out/ProductionMarketActivator.sol/ProductionMarketActivator.json",
);
const outputPath = resolve(projectRoot, "src/generated/productionBytecode.js");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const bytecode = artifact?.bytecode?.object;

if (!/^0x[0-9a-fA-F]+$/.test(bytecode || "")) {
  throw new Error("ProductionMarketActivator creation bytecode is missing. Run forge build first.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `// Generated from the pinned Foundry artifact. Do not edit by hand.\nexport const PRODUCTION_ACTIVATOR_BYTECODE = ${JSON.stringify(bytecode)};\n`,
  "utf8",
);

console.log(`Generated ${outputPath} (${(bytecode.length - 2) / 2} bytes).`);
