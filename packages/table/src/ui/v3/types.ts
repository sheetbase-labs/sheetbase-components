import type { ReactNode } from "react";

/**
 * A v3 design-grid fixture module. The dispatcher creates the `#grid-fixture`
 * host at exactly `width`×`height` (the design crop's box) and renders
 * `render(theme)` inside it, so the element screenshot is directly comparable
 * with the cropped design render.
 */
export interface V3FixtureModule {
  /** Crop width in CSS px (deviceScaleFactor 1). */
  width: number;
  /** Crop height in CSS px. */
  height: number;
  render(theme: "light" | "dark"): ReactNode;
}
