import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assemble(partsDir, dest) {
  const dir = join(root, partsDir);
  const files = readdirSync(dir).filter((name) => name.endsWith(".txt")).sort();
  mkdirSync(dirname(join(root, dest)), { recursive: true });
  writeFileSync(join(root, dest), files.map((name) => readFileSync(join(dir, name), "utf8")).join(""));
}

assemble("src/ui/spreadsheet.parts", "src/ui/Spreadsheet.tsx");
assemble("src/ui/styles.parts", "src/ui/styles.css");
assemble("src/engine/functions.parts", "src/engine/functions.ts");
