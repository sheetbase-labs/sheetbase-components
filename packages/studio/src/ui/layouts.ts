import type { Layout } from '@sheetbase-labs/sheetbase-shared'

export const DEFAULT_LAYOUT: Layout = {
  kind: 'split',
  id: 'sbs-root',
  direction: 'row',
  sizes: [0.23, 0.77],
  children: [
    { kind: 'stack', id: 'sbs-fields', panes: ['fields'], active: 'fields' },
    {
      kind: 'split',
      id: 'sbs-main',
      direction: 'column',
      sizes: [0.6, 0.4],
      children: [
        {
          kind: 'split',
          id: 'sbs-top',
          direction: 'row',
          sizes: [0.64, 0.36],
          children: [
            { kind: 'stack', id: 'sbs-chart', panes: ['chart'], active: 'chart' },
            { kind: 'stack', id: 'sbs-filters', panes: ['filters'], active: 'filters' },
          ],
        },
        { kind: 'stack', id: 'sbs-data', panes: ['table', 'sql'], active: 'table' },
      ],
    },
  ],
}

/** Short screens: fields beside one tabbed stack, so the chart keeps the full height. */
export const SHORT_LAYOUT: Layout = {
  kind: 'split',
  id: 'sbs-short',
  direction: 'row',
  sizes: [0.26, 0.74],
  children: [
    { kind: 'stack', id: 'sbs-fields', panes: ['fields'], active: 'fields' },
    { kind: 'stack', id: 'sbs-work', panes: ['chart', 'filters', 'table', 'sql'], active: 'chart' },
  ],
}

/** Narrow screens: one stack, every pane a tab. */
export const NARROW_LAYOUT: Layout = { kind: 'stack', id: 'sbs-all', panes: ['chart', 'fields', 'filters', 'table', 'sql'], active: 'chart' }

export type LayoutMode = 'wide' | 'short' | 'narrow'

/** Below this body width, panes become tabs. */
export const NARROW_WIDTH = 760
/** Below this body height, chart and rows can't share a column; they become tabs. */
export const SHORT_HEIGHT = 600
/** Below this body height even the fields column is too cramped to sit beside the work. */
export const TINY_HEIGHT = 300

/** Which layout suits a body of this size. */
export function layoutModeFor(width: number, height: number): LayoutMode {
  if (width < NARROW_WIDTH || height < TINY_HEIGHT) return 'narrow'
  if (height < SHORT_HEIGHT) return 'short'
  return 'wide'
}

export const LAYOUTS: Readonly<Record<LayoutMode, Layout>> = { wide: DEFAULT_LAYOUT, short: SHORT_LAYOUT, narrow: NARROW_LAYOUT }
