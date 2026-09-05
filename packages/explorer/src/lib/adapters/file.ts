import Papa from 'papaparse'
import { inferColumns } from '../schema'
import type { DataRow, Dataset } from '../types'

function normalizeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return null
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true'
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return Number(text)
  return text
}

function normalizeRows(rows: DataRow[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])))
}

export async function datasetFromFile(file: File): Promise<Dataset> {
  const text = await file.text()
  const lower = file.name.toLowerCase()
  let rows: DataRow[]

  if (lower.endsWith('.json')) {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('JSON files must contain an array of objects.')
    rows = parsed as DataRow[]
  } else {
    const result = Papa.parse<DataRow>(text, { header: true, skipEmptyLines: true })
    if (result.errors.length) throw new Error(result.errors[0].message)
    rows = result.data
  }

  rows = normalizeRows(rows)
  return { name: file.name, rows, columns: inferColumns(rows), source: 'file' }
}
