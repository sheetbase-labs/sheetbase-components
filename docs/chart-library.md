# Chart library decision (plan 025)

**Decision: (b) — upgraded `@tanstack/charts` 0.16.0 → 0.18.0** (2026-09-12).
`chart.ts` stays the permanent adapter boundary; the `as any` seams are the
known tax, not a migration signal.

## Survey

`npm view @tanstack/charts` (2026-09-12):

- Still 0.x — no stable/1.x. Latest: `0.18.0`, published 2026-09-10.
- Cadence is fast: `0.13.0` → `0.18.0` in four weeks (six releases). This
  is an actively-developed alpha, not a stalled one.
- 0.18.0 peers: `react ^18.0.0 || ^19.0.0` (+ `react-dom`), all framework
  peers marked `optional`. At 0.16.0 the react peer was `^19.0.0` only.

## Seam inventory

- `packages/explorer/src/lib/chart.ts` — 41 `as any` casts, all on
  mark/transform builder option objects (`barY`, `lineY`, `dot`, `link`,
  `tickY`, `rect`, `boxY`, `cell`, `areaY`, `violinY`, `waterfall`, `pie`/
  `radialArc`, `binX`/`binY`, `normalize`, `waterfall`, scales, `tooltip`,
  `zoomX`, `controlledSignal`). Deep subpath imports
  (`@tanstack/charts/tooltip`, `/polar`, `/interaction/*`, `/scales/*`).
- `packages/explorer/src/explorer-chrome.tsx` — the single `<Chart>` site
  (`definition`, `height`, `ariaLabel`, `renderTooltipBody`, `onSelect`).
- No other file imports the library (`grep -l tanstack src/` → the two
  files above). The isolation premise holds.

## The peer-range question, resolved

The worry: our declared `react >=18` vs charts' `^19` peer. Evidence:
the workspace installs react `^19.1.0` and the explorer demo renders on
it — we were never actually broken — but a consumer on react 18 would
have hit a peer smell at install. Upstream fixed it: 0.18.0 declares
`^18.0.0 || ^19.0.0` optional. Our `>=18` declaration now sits cleanly
inside upstream's range; no peer change needed on our side.

## Rationale

The plan's default was (a) stay pinned unless upstream shipped a
meaningfully-fixed release. 0.18.0 is that release for our specific
concern (the react peer range is exactly what publish would expose), and
the bump proved mechanical: `tsc` clean, all 54 explorer tests pass
unmodified, `build` + `pack:smoke` pass. Zero seam sites broke — the
subpath API we use is stable across the two minors.

Staying pinned at 0.16.0 would have bought nothing but a worse peer
declaration; migrating off (option c — direct d3, visx, Recharts) would
re-implement the accessibility contract (`role="img"`,
`aria-roledescription="chart"`, focusable marks) and every mark builder
for no concrete gain. Recorded and rejected.

## Follow-ups

- Re-check at the next upstream minor (and any 1.x): pinned alphas go
  stale quietly. Each bump so far has been mechanical — repeat the
  bump → typecheck → explorer-test → pack:smoke loop; if a bump ever
  breaks >~15 seam sites, that's evidence to revisit (a)/(c).
- Keep the boundary: new chart kinds extend `chart.ts`; nothing else
  imports `@tanstack/charts`.
- If a future consumer reports alpha-drift breakage, the adapter already
  contains the spec→definition translation — a swap touches one file.
