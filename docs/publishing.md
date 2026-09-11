# Publishing & consumption

**Decision: real publish (assumed — pending maintainer confirmation).** The six
public packages (`sheetbase-shared`, `sheetbase-table`,
`sheetbase-advanced-search`, `sheetbase-explorer`, `sheetbase-schemaeditor`,
`sheetbase-rulesengine`) publish to npm; `sheetbase-demo` stays private.
Chosen because the manifests are already publish-shaped and `bun pm pack`
rewrites `workspace:*` deps to real versions at pack time — verified: the
packed `sheetbase-table` manifest reads `"sheetbase-shared": "0.1.0"`.

## What a consumer installs

Peers: `react`/`react-dom` (>=18) everywhere, plus `@tanstack/react-virtual`
for `sheetbase-table` (externalized from its lib bundle). Everything else is
either a real `dependencies` entry or bundled into `dist-lib` — including
`sheetbase-shared`, which the table lib imports rather than inlines.

```ts
import { Spreadsheet } from "sheetbase-table";
import "sheetbase-table/styles.css";
```

`sheetbase-shared` also exports `./theme.css`, `./shell.css`, `./panes.css`
(source files, shipped via `files`) and both `./styles.css` and the legacy
`./style.css` alias for its bundled css.

## Versioning

Lockstep — one `sheetbase` release line, all packages bump together. While
the contract is young there is no consumer benefit to independent versions,
and `workspace:*` consumers always get the local version anyway.

## Publish flow (manual, credentials stay local)

```bash
bun install
bun run typecheck && bun run lint && bun run test
bun run pack:smoke            # packs all six, installs + typechecks as a consumer
# bump versions in lockstep, then in dependency order:
cd packages/shared       && bun publish --access public
cd ../table              && bun publish --access public
cd ../advanced-search    && bun publish --access public
cd ../explorer           && bun publish --access public
cd ../schema-editor      && bun publish --access public
cd ../rules-engine       && bun publish --access public
```

`bun publish` rewrites `workspace:*` the same way `bun pm pack` does — the
smoke test verifies exactly what consumers will install.

CI runs `pack-smoke --skip-build` on every PR after the lib builds, so a
manifest regression fails review without touching a registry.

## Not done yet

- No NPM_TOKEN / release workflow — first publish is a deliberate manual act.
- No CHANGELOG.md generation; add one with the first real `0.2.0`.
