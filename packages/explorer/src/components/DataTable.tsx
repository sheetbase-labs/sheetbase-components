import { useEffect, useMemo, useRef, useState } from 'react'
import { ROW_ID } from '../lib/explore'
import { sortRows } from '../lib/sort'
import type { DataRow, Dataset } from '../lib/types'

interface Props {
  dataset: Dataset
  rows?: DataRow[]
  selectedRow?: number
  onSelectRow?(index: number): void
}

const ROW_HEIGHT = 29
const OVERSCAN = 12

/**
 * Windowed data inspector borrowing the sheetbase-table viewport concept:
 * only the visible row window plus overscan is mounted, so connecting a
 * multi-thousand-row Sheetbase page no longer mounts thousands of `<tr>`.
 * Rows are fixed height (matching `styles.css`) with sticky headers and
 * top/bottom spacers preserving the scrollbar.
 */
export function DataTable({ dataset, rows: suppliedRows, selectedRow, onSelectRow }: Props) {
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const shellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const measure = () => {
      setViewportHeight(shell.clientHeight)
      setScrollTop(shell.scrollTop)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(shell)
    return () => observer.disconnect()
  }, [dataset])

  const sorted = useMemo(() => {
    const source = suppliedRows ?? dataset.rows
    if (!sort) return source
    return sortRows(source, sort.key, sort.direction)
  }, [dataset.rows, suppliedRows, sort])

  const total = sorted.length
  const visibleCount = Math.max(1, Math.ceil((viewportHeight || 600) / ROW_HEIGHT) + OVERSCAN * 2)
  const start = Math.max(0, Math.min(total, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN))
  const end = Math.min(total, start + visibleCount)
  const windowed = sorted.slice(start, end)
  const columnCount = dataset.columns.length + 1

  function toggleSort(key: string) {
    setSort((current) => current?.key === key
      ? current.direction === 'asc' ? { key, direction: 'desc' } : null
      : { key, direction: 'asc' })
  }

  return (
    <div className="table-shell" ref={shellRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <table>
        <thead><tr><th className="row-number">#</th>{dataset.columns.map((column) => <th key={column.key} onClick={() => toggleSort(column.key)} className="sortable-header">{column.key}<span>{sort?.key === column.key ? (sort.direction === 'asc' ? '↑' : '↓') : column.kind}</span></th>)}</tr></thead>
        <tbody>
          {start > 0 && <tr className="spacer-row" aria-hidden><td colSpan={columnCount} style={{ height: start * ROW_HEIGHT, padding: 0, border: 0 }} /></tr>}
          {windowed.map((row, index) => {
            const rowId = typeof row[ROW_ID] === 'number' ? Number(row[ROW_ID]) : start + index
            return (
              <tr key={`${rowId}-${start + index}`} className={selectedRow === rowId ? 'selected-data-row' : ''} onClick={() => onSelectRow?.(rowId)}>
                <td className="row-number">{rowId + 1}</td>
                {dataset.columns.map((column) => <td key={column.key}>{String(row[column.key] ?? '')}</td>)}
              </tr>
            )
          })}
          {end < total && <tr className="spacer-row" aria-hidden><td colSpan={columnCount} style={{ height: (total - end) * ROW_HEIGHT, padding: 0, border: 0 }} /></tr>}
        </tbody>
      </table>
      {total > windowed.length && <div className="table-note">Rendering {windowed.length.toLocaleString()} of {total.toLocaleString()} rows (virtualized)</div>}
    </div>
  )
}
