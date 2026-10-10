/** Below this the chart stops shrinking (its text would collide); hosts should lay out to stay above it. */
export const MIN_CHART_HEIGHT = 120

/**
 * The height to draw the chart at: the stage's content box, which the chart's
 * SVG is stretched to fill. Drawing at any other height makes the browser
 * scale the figure — tiny text in short stages, letterboxing in tall ones.
 */
export function stageChartHeight(clientHeight: number, paddingTop = 0, paddingBottom = 0): number {
  const content = Math.floor(clientHeight - (Number.isFinite(paddingTop) ? paddingTop : 0) - (Number.isFinite(paddingBottom) ? paddingBottom : 0))
  return Math.max(MIN_CHART_HEIGHT, content)
}
