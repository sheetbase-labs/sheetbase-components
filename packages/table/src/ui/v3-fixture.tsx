/// <reference types="vite/client" />
/**
 * COMP-02.6 visual-fixture dispatcher.
 *
 * Each design grid lives in its own module under `./v3/` as a
 * `V3FixtureModule` default export. The URL selects one with `?fixture=<name>`
 * (default `sheetworking-grid`) and a theme with `?theme=light|dark`; the
 * dispatcher sizes the host element to the fixture's crop box and renders it. New modules
 * are picked up by the glob, so adding a grid is one file plus its crop.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/themes/v3.css";
import "./styles.css";
import type { V3FixtureModule } from "./v3/types";

const params = new URLSearchParams(window.location.search);
const name = params.get("fixture") ?? "sheetworking-grid";
const theme = params.get("theme") === "dark" ? "dark" : "light";

const modules = import.meta.glob<{ default: V3FixtureModule }>("./v3/*.tsx", { eager: true });
const fixture = modules[`./v3/${name}.tsx`]?.default;
if (!fixture) {
  throw new Error(`v3 fixture "${name}" not found; have: ${Object.keys(modules).map((key) => key.replace("./v3/", "").replace(".tsx", "")).join(", ")}`);
}

const host = document.createElement("div");
host.id = "grid-fixture";
// Expose the theme variables to the host itself, so a fixture can style the
// area the grid does not paint (rounded-corner page background) with tokens.
host.className = "sheetbase-scope";
host.dataset.theme = theme;
host.style.width = `${fixture.width}px`;
host.style.height = `${fixture.height}px`;
document.getElementById("root")?.append(host);

ReactDOM.createRoot(host).render(<React.StrictMode>{fixture.render(theme)}</React.StrictMode>);
