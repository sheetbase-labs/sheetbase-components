# Publishing & consumption

**Decision: private publish to GitHub Packages (DEC-12).** The seven library packages (`@sheetbase-labs/sheetbase-shared`, `@sheetbase-labs/sheetbase-table`, `@sheetbase-labs/sheetbase-advanced-search`, `@sheetbase-labs/sheetbase-explorer`, `@sheetbase-labs/sheetbase-schemaeditor`, `@sheetbase-labs/sheetbase-rulesengine`, `@sheetbase-labs/sheetbase-studio`) publish to GitHub Packages at `https://npm.pkg.github.com`, scoped to the `sheetbase-labs` organisation. `sheetbase-demo` stays private and is never published. Nothing is published to public npm: the packages are private, every manifest carries `publishConfig.access: restricted`, and no workflow passes `--access public`.

GitHub Packages only accepts **scoped** npm packages whose scope matches the repository owner, which is why the manifests are `@sheetbase-labs/*`. The manifests are otherwise publish-shaped and `bun pm pack` rewrites `workspace:*` deps to real versions at pack time — verified: the packed `@sheetbase-labs/sheetbase-table` manifest reads `"@sheetbase-labs/sheetbase-shared": "0.1.0"`.

## What a consumer installs

Peers: `react`/`react-dom` (>=18) everywhere, plus `@tanstack/react-virtual` for `@sheetbase-labs/sheetbase-table` (externalized from its lib bundle). Everything else is either a real `dependencies` entry or bundled into `dist-lib` — including `@sheetbase-labs/sheetbase-shared`, which the table lib imports rather than inlines.

```ts
import { Spreadsheet } from "@sheetbase-labs/sheetbase-table";
import "@sheetbase-labs/sheetbase-table/styles.css";
```

`@sheetbase-labs/sheetbase-shared` also exports `./theme.css`, `./shell.css`, `./panes.css` (source files, shipped via `files`) and both `./styles.css` and the legacy `./style.css` alias for its bundled css.

## Consumer authentication

Consumers point the `@sheetbase-labs` scope at GitHub Packages in a committed `.npmrc`; the token itself never is:

```ini
@sheetbase-labs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Locally, set the token in the user-level config (`pnpm config set "//npm.pkg.github.com/:_authToken" <PAT>`, a personal access token (classic) with `read:packages`). In GitHub Actions, use the built-in token — note that pnpm ≥10 ignores credentials in a *project* `.npmrc`, so CI writes the value into the user-level file before installing:

```yaml
permissions:
  contents: read
  packages: read

env:
  NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

steps:
  - run: echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc
  - run: pnpm install --frozen-lockfile
```

`GITHUB_TOKEN` can read packages owned by the same organisation that ran the workflow; the package must be visible to the consuming repository (packages published from a repository that sets `repository` in `package.json` inherit that repository's access, and the org can also grant access org-wide). The ELN consumption side is documented in `sheetbase-eln/docs/development/sheetbase-components.md`.

## Versioning

Lockstep — one `sheetbase` release line, all packages bump together. Consumers depend on exact versions; upgrades are ordinary PRs.

## Publish flow (tag-driven, built-in token)

```bash
bun install
bun run typecheck && bun run lint && bun run test
bun run version:bump 0.2.0     # rewrites version in all seven manifests
# update CHANGELOG.md, commit:
git tag v0.2.0 && git push origin main --tags
```

The `v*` tag triggers `.github/workflows/release.yml`: full verify (typecheck/lint/tests), lib builds, pack smoke, a tag↔manifest version check, then `bun publish --access restricted` in dependency order. The job declares `permissions: packages: write` and publishes with the built-in Actions token (`NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`); no `NPM_TOKEN` secret exists. `workflow_dispatch` runs the same pipeline minus the tag check.

`bun publish` rewrites `workspace:*` the same way `bun pm pack` does, and each manifest's `publishConfig` supplies the registry (`https://npm.pkg.github.com`) and `access: restricted`, so publishing from a package directory cannot reach public npm by accident.

## Publish flow (manual, credentials stay local)

For an out-of-band release, authenticate locally and publish from each package directory in dependency order — `publishConfig` routes to GitHub Packages:

```bash
bun install
bun run typecheck && bun run lint && bun run test
bun run pack:smoke            # packs all seven, installs + typechecks as a consumer
cd packages/shared       && bun publish --access restricted
cd ../table              && bun publish --access restricted
cd ../advanced-search    && bun publish --access restricted
cd ../explorer           && bun publish --access restricted
cd ../schema-editor      && bun publish --access restricted
cd ../rules-engine       && bun publish --access restricted
cd ../studio             && bun publish --access restricted
```

Studio's peers are the same as the table's (`react`, `react-dom`, `@tanstack/react-virtual`). DuckDB-WASM, `hyparquet` and `read-excel-file` are real dependencies left external to `dist-lib` and loaded lazily — a host's bundler resolves them, and nothing downloads until a file or SQL needs them.

## The Python package

`python/` (`sheetbase-studio` on the same version line — `scripts/version.mjs` bumps it too) is not published to a package index. CI builds the Studio UI into it and uploads the wheel as a workflow artifact; install that wheel, or build one locally:

```bash
bun run --filter @sheetbase-labs/sheetbase-studio build:python
uv build python            # dist/sheetbase_studio-<version>-py3-none-any.whl
```

CI runs `pack-smoke --skip-build` on every PR after the lib builds, so a manifest regression fails review without touching a registry.

`CHANGELOG.md` is manual — one heading per lockstep release.

## Local development against unreleased packages

Consume the workspace directly instead of publishing: a `link:`/workspace override in the consumer (never committed). See the ELN doc linked above for the exact recipe.

## Still manual

- Creating the first `v0.1.0` tag (the built-in token needs no secret).
- Granting the ELN repository read access to each published package (or relying on organisation-wide access).
