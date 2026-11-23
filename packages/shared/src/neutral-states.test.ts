import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hover, focus, selected and active states are neutral, never the accent blue.
 * Inside a state rule, read the accent through the state tokens instead:
 *   text/ink  -> var(--state-ink, var(--accent-dark))   (or --accent-ink)
 *   edge/ring -> var(--state-edge, var(--accent))       (or --focus)
 * Surfaces use --accent-soft / --accent-soft-2 / --selection, which the host
 * maps to neutral greys. Primary-button rules (.primary) are exempt.
 */
const STATE =
  /:hover|:focus|:active|\.selected|\.active\b|\.is-active|\.is-on\b|\.on\b|\.toggled|\.is-drop|aria-selected|aria-current|aria-pressed|\.selection-outline|\.move-outline|\.spill-range|\.copy-outline|\.fill-handle|\.in-selection|\.selected-header|\.current\b/;
const BARE = /(?<!state-edge, )var\(--(accent|focus)\)|(?<!state-ink, )var\(--(accent-dark|accent-ink)\)/g;
const RULE = /([^{}]+)\{([^{}]*)\}/g;

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "dist-lib" || name === "demo") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) cssFiles(path, out);
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

describe("neutral interaction states", () => {
  it("keeps the accent blue out of hover, focus, selected and active rules", () => {
    const root = join(__dirname, "../..");
    const bad: string[] = [];
    for (const pkg of readdirSync(root)) {
      if (pkg === "demo") continue; // the demo workbench has its own theme
      const src = join(root, pkg, "src");
      try {
        statSync(src);
      } catch {
        continue;
      }
      for (const file of cssFiles(src)) {
        const text = readFileSync(file, "utf8");
        for (const m of text.matchAll(RULE)) {
          const [, selector, body] = m;
          if (!STATE.test(selector) || /\.primary/.test(selector)) continue;
          const hits = body.match(BARE);
          if (hits) bad.push(`${relative(root, file)}: ${selector.trim().slice(0, 70)} uses ${hits.join(", ")}`);
        }
      }
    }
    expect(
      bad,
      "State rules must be neutral. Use var(--state-edge, var(--accent)) for borders and rings, var(--state-ink, var(--accent-dark)) for text, and --accent-soft for surfaces.",
    ).toEqual([]);
  });
});
