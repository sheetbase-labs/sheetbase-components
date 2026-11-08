/**
 * Declarative cell displays: how a host says "show this value as a pass/fail
 * pill" or "as a bar out of 100" without running any code in a grid cell.
 *
 * A grid can hold thousands of cells, so a display is data, never a function.
 * The same spec shape is drawn by the Sheetbase app's record tables; both
 * repositories run `CELL_DISPLAY_FIXTURES` against `cellDisplayModel`, so they
 * cannot disagree about what a spec shows.
 */

export const CELL_DISPLAY_TONES = [
  'neutral',
  'success',
  'warning',
  'danger',
  'info',
] as const
export type CellDisplayTone = (typeof CELL_DISPLAY_TONES)[number]

export type CellDisplaySpec =
  | { kind: 'text'; prefix?: string; suffix?: string; mono?: boolean }
  | {
      kind: 'number'
      decimals?: number
      unit?: string
      /** Show 1,234.5 rather than 1234.5. */
      grouping?: boolean
    }
  | {
      kind: 'badge'
      /** Value to tone. A value not listed uses `fallback`. */
      tones: Record<string, CellDisplayTone>
      /** Value to the words shown. A value not listed shows as it is. */
      labels?: Record<string, string>
      fallback?: CellDisplayTone
    }
  | {
      kind: 'bar'
      min?: number
      max: number
      tone?: CellDisplayTone
      /** The first threshold a value is below wins; above all of them uses `tone`. */
      thresholds?: Array<{ below: number; tone: CellDisplayTone }>
      showValue?: boolean
    }
  | { kind: 'sparkline'; tone?: CellDisplayTone }
  | { kind: 'svg' }

export type CellDisplayModel =
  | { kind: 'empty' }
  | { kind: 'text'; text: string; mono: boolean }
  | { kind: 'badge'; text: string; tone: CellDisplayTone }
  | {
      kind: 'bar'
      /** 0 to 1. */
      fraction: number
      tone: CellDisplayTone
      label: string | null
    }
  | { kind: 'sparkline'; values: number[]; tone: CellDisplayTone }
  | { kind: 'svg'; svg: string }

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function formatDisplayNumber(
  n: number,
  decimals: number | undefined,
  grouping: boolean | undefined,
): string {
  const fixed = decimals === undefined ? String(n) : n.toFixed(decimals)
  if (!grouping) return fixed
  const [whole, fraction] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** The numbers in a sparkline cell: a JSON list, or numbers split by commas, spaces or semicolons. */
export function sparklineValues(value: unknown): number[] {
  if (Array.isArray(value))
    return value.map(asNumber).filter((n): n is number => n !== null)
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Array.isArray(parsed) ? sparklineValues(parsed) : []
    } catch {
      return []
    }
  }
  return trimmed
    .split(/[\s,;]+/)
    .map(asNumber)
    .filter((n): n is number => n !== null)
}

export function cellDisplayModel(
  spec: CellDisplaySpec,
  value: unknown,
): CellDisplayModel {
  const blank = value === null || value === undefined || value === ''
  if (blank) return { kind: 'empty' }
  const raw = String(value)
  switch (spec.kind) {
    case 'text':
      return {
        kind: 'text',
        text: `${spec.prefix ?? ''}${raw}${spec.suffix ?? ''}`,
        mono: spec.mono === true,
      }
    case 'number': {
      const n = asNumber(value)
      if (n === null) return { kind: 'text', text: raw, mono: false }
      const text = formatDisplayNumber(n, spec.decimals, spec.grouping)
      return {
        kind: 'text',
        text: spec.unit ? `${text} ${spec.unit}` : text,
        mono: false,
      }
    }
    case 'badge':
      return {
        kind: 'badge',
        text: spec.labels?.[raw] ?? raw,
        tone: spec.tones[raw] ?? spec.fallback ?? 'neutral',
      }
    case 'bar': {
      const n = asNumber(value)
      if (n === null) return { kind: 'text', text: raw, mono: false }
      const min = spec.min ?? 0
      const fraction = Math.min(1, Math.max(0, (n - min) / (spec.max - min)))
      const matched = spec.thresholds?.find((entry) => n < entry.below)
      const above = spec.thresholds?.at(-1)
      return {
        kind: 'bar',
        fraction,
        tone: matched?.tone ?? spec.tone ?? (above ? 'success' : 'info'),
        label:
          spec.showValue === false
            ? null
            : formatDisplayNumber(n, undefined, false),
      }
    }
    case 'sparkline': {
      const values = sparklineValues(value)
      return values.length < 2
        ? { kind: 'text', text: raw, mono: false }
        : { kind: 'sparkline', values, tone: spec.tone ?? 'info' }
    }
    case 'svg':
      return { kind: 'svg', svg: raw }
  }
}

/**
 * Cases both repositories run against their renderer model, so the app and the
 * table package cannot disagree about what a spec shows.
 */
export const CELL_DISPLAY_FIXTURES: Array<{
  spec: CellDisplaySpec
  value: unknown
  expect: CellDisplayModel
}> = [
  {
    spec: { kind: 'badge', tones: { pass: 'success', fail: 'danger' } },
    value: 'pass',
    expect: { kind: 'badge', text: 'pass', tone: 'success' },
  },
  {
    spec: {
      kind: 'badge',
      tones: { pass: 'success' },
      labels: { fail: 'Failed' },
      fallback: 'danger',
    },
    value: 'fail',
    expect: { kind: 'badge', text: 'Failed', tone: 'danger' },
  },
  {
    spec: { kind: 'number', decimals: 1, unit: 'µM', grouping: true },
    value: 12345.678,
    expect: { kind: 'text', text: '12,345.7 µM', mono: false },
  },
  {
    spec: {
      kind: 'bar',
      max: 100,
      thresholds: [
        { below: 50, tone: 'danger' },
        { below: 80, tone: 'warning' },
      ],
      tone: 'success',
    },
    value: 64,
    expect: { kind: 'bar', fraction: 0.64, tone: 'warning', label: '64' },
  },
  {
    spec: { kind: 'sparkline' },
    value: '1, 3, 2',
    expect: { kind: 'sparkline', values: [1, 3, 2], tone: 'info' },
  },
  {
    spec: { kind: 'text', suffix: ' bp' },
    value: '1200',
    expect: { kind: 'text', text: '1200 bp', mono: false },
  },
  { spec: { kind: 'text' }, value: '', expect: { kind: 'empty' } },
]
