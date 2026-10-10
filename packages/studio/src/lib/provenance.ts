import type { AnalysisView, DatasetQuery, StudioDataSource, TableInfo } from '@sheetbase-labs/sheetbase-shared'

/**
 * Where a chart came from: the source, the table (and its SQL when it is a
 * query result), the exact filter tree and chart spec, the readable SQL, and
 * how many rows matched — enough to reproduce the figure or audit it.
 */
export interface Provenance {
  format: 'sheetbase-studio/provenance'
  version: 1
  generatedAt: string
  source: { id: string; label: string; kind: string }
  table: { id: string; label: string; kind: TableInfo['kind']; rowCount: number | null; sql?: string }
  matchingRows: number | null
  view: AnalysisView
  query: DatasetQuery
  chart: unknown
  sql: string
}

export function buildProvenance(input: {
  source: StudioDataSource
  table: TableInfo
  view: AnalysisView
  query: DatasetQuery
  chart: unknown
  sql: string
  matchingRows: number | null
  now?: Date
}): Provenance {
  return {
    format: 'sheetbase-studio/provenance',
    version: 1,
    generatedAt: (input.now ?? new Date()).toISOString(),
    source: { id: input.source.id, label: input.source.label, kind: input.source.kind },
    table: {
      id: input.table.id,
      label: input.table.label,
      kind: input.table.kind,
      rowCount: input.table.rowCount,
      ...(input.table.sql ? { sql: input.table.sql } : {}),
    },
    matchingRows: input.matchingRows,
    view: input.view,
    query: input.query,
    chart: input.chart,
    sql: input.sql,
  }
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Embed provenance in an SVG as a `<metadata>` element, so the file carries its own record. */
export function svgWithProvenance(svg: string, provenance: Provenance): string {
  const metadata = `<metadata id="sheetbase-provenance" data-format="${provenance.format}">${escapeXml(JSON.stringify(provenance))}</metadata>`
  const open = svg.match(/<svg\b[^>]*>/)
  if (!open || open.index === undefined) return svg
  const at = open.index + open[0].length
  return `${svg.slice(0, at)}${metadata}${svg.slice(at)}`
}

/** Read provenance back out of an exported SVG (for audits and round-trip tests). */
export function readSvgProvenance(svg: string): Provenance | null {
  const match = svg.match(/<metadata id="sheetbase-provenance"[^>]*>([\s\S]*?)<\/metadata>/)
  if (!match?.[1]) return null
  const text = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return JSON.parse(text) as Provenance
}
