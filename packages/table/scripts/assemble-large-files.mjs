import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Spreadsheet.tsx still exceeds the GitHub contents limit, so it is stored as ordered parts. */
function assemble(partsDir, dest) {
  const dir = join(root, partsDir);
  const files = readdirSync(dir).filter((name) => name.endsWith(".txt")).sort();
  mkdirSync(dirname(join(root, dest)), { recursive: true });
  writeFileSync(join(root, dest), files.map((name) => readFileSync(join(dir, name), "utf8")).join(""));
}

assemble("src/ui/spreadsheet.parts", "src/ui/Spreadsheet.tsx");
