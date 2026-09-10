import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface DataGridColumn {
  id: string;
  label: string;
  /** Optional type hint shown next to the label (e.g. "string", "number"). */
  kind?: string;
}

export interface DataGridProps {
  columns: readonly DataGridColumn[];
  rows: readonly Record<string, unknown>[];
  /** Stable row identity; defaults to the row index. */
  rowKey?(row: Record<string, unknown>, index: number): string | number;
  /** Leading row-number column, or a render function for custom numbering. Default true. */
  rownum?: boolean | ((row: Record<string, unknown>, index: number) => ReactNode);
  /** Selected row key (see `rowKey`). */
  selectedKey?: string | number;
  onSelectRow?(key: string | number, row: Record<string, unknown>, index: number): void;
  /** Click-to-sort headers. Default false. */
  sortable?: boolean;
  emptyMessage?: string;
  className?: string;
}

const ROW_HEIGHT = 29;
const OVERSCAN = 12;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sortValue(value: unknown): number | string {
  if (typeof value === "number") return value;
  const numeric = Number(value);
  if (value !== "" && Number.isFinite(numeric)) return numeric;
  return String(value ?? "");
}

/**
 * Read-only tabular view for previews and inspectors. Fixed-height, windowed
 * rows with sticky headers, sharing the `.sb-table` styling. This is the table
 * other components should render instead of rolling their own `<table>`.
 */
export function DataGrid({
  columns,
  rows,
  rowKey,
  rownum = true,
  selectedKey,
  onSelectRow,
  sortable = false,
  emptyMessage = "No rows.",
  className = "",
}: DataGridProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setViewportHeight(shell.clientHeight);
      setScrollTop(shell.scrollTop);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  const ordered = useMemo(() => {
    if (!sort) return rows.map((row, index) => ({ row, index }));
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const av = sortValue(a.row[sort.id]);
        const bv = sortValue(b.row[sort.id]);
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sort.direction === "desc" ? -cmp : cmp;
      });
  }, [rows, sort]);

  const total = ordered.length;
  const visibleCount = Math.max(1, Math.ceil((viewportHeight || 600) / ROW_HEIGHT) + OVERSCAN * 2);
  const start = Math.max(0, Math.min(total, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  const end = Math.min(total, start + visibleCount);
  const windowed = ordered.slice(start, end);
  const columnCount = columns.length + (rownum ? 1 : 0);

  function toggleSort(id: string) {
    setSort((current) => current?.id === id
      ? current.direction === "asc" ? { id, direction: "desc" } : null
      : { id, direction: "asc" });
  }

  return (
    <div
      className={`sb-table-wrap ${className}`.trim()}
      ref={shellRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <table className="sb-table">
        <thead>
          <tr>
            {rownum && <th className="sb-rownum">#</th>}
            {columns.map((column) => {
              const active = sort?.id === column.id;
              return (
                <th key={column.id} aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined}>
                  {sortable ? (
                    <button
                      type="button"
                      className="sb-sort-button"
                      aria-label={`Sort by ${column.label}`}
                      onClick={() => toggleSort(column.id)}
                    >
                      {column.label}
                      <span>{active ? (sort!.direction === "asc" ? "↑" : "↓") : column.kind}</span>
                    </button>
                  ) : (
                    <>{column.label}{column.kind && <span>{column.kind}</span>}</>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {total === 0 && (
            <tr>
              <td className="sb-muted" colSpan={Math.max(1, columnCount)} style={{ padding: 14 }}>{emptyMessage}</td>
            </tr>
          )}
          {start > 0 && (
            <tr aria-hidden="true">
              <td colSpan={Math.max(1, columnCount)} style={{ height: start * ROW_HEIGHT, padding: 0, border: 0 }} />
            </tr>
          )}
          {windowed.map(({ row, index }) => {
            const key = rowKey ? rowKey(row, index) : index;
            const selected = selectedKey !== undefined && selectedKey === key;
            return (
              <tr
                key={key}
                className={selected ? "selected" : undefined}
                aria-selected={selected ? true : undefined}
                tabIndex={onSelectRow ? 0 : undefined}
                onClick={onSelectRow ? () => onSelectRow(key, row, index) : undefined}
                onKeyDown={onSelectRow
                  ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectRow(key, row, index); } }
                  : undefined}
              >
                {rownum && <td className="sb-rownum">{typeof rownum === "function" ? rownum(row, index) : index + 1}</td>}
                {columns.map((column) => <td key={column.id}>{cellText(row[column.id])}</td>)}
              </tr>
            );
          })}
          {end < total && (
            <tr aria-hidden="true">
              <td colSpan={Math.max(1, columnCount)} style={{ height: (total - end) * ROW_HEIGHT, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
