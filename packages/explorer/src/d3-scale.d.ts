/**
 * `d3-scale` ships without types and is not a direct dependency of this package.
 * `@tanstack/charts` already bundles it for its D3 scale upgrades, so we declare
 * only the surface the explorer uses: logarithmic axes and quantitative colour.
 */
declare module 'd3-scale' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function scaleLog(): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function scaleLinear(): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function scaleSequential(interpolator: (t: number) => string): any
}
