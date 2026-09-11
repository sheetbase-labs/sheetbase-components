import type { RangeStore, Worksheet } from "../engine";
import type { CellFormat } from "../engine";
import { CellStore } from "./cell-store";

export type CellChange = Readonly<{
  address: string;
  before?: string;
  after?: string;
}>;

export type ColumnWidthChange = Readonly<{
  column: number;
  before: number;
  after: number;
}>;

export type GridMutation = Readonly<{
  label: string;
  cells: readonly CellChange[];
  formats?: Readonly<{
    before: RangeStore<CellFormat>;
    after: RangeStore<CellFormat>;
  }>;
  columnWidths: readonly ColumnWidthChange[];
}>;

export function cellMutation(
  label: string,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
  affectedAddresses?: Iterable<string>,
): GridMutation {
  const addresses = affectedAddresses ? new Set(affectedAddresses) : new Set([...before.keys(), ...after.keys()]);
  const cells: CellChange[] = [];
  for (const address of addresses) {
    const previous = before.get(address);
    const next = after.get(address);
    if (previous !== next) cells.push({ address, before: previous, after: next });
  }
  return { label, cells, columnWidths: [] };
}

export function cellChangesMutation(label: string, cells: readonly CellChange[]): GridMutation {
  return { label, cells: cells.filter((change) => change.before !== change.after), columnWidths: [] };
}

export function formatMutation(
  label: string,
  before: RangeStore<CellFormat>,
  after: RangeStore<CellFormat>,
): GridMutation {
  return {
    label,
    cells: [],
    formats: { before: before.clone(), after: after.clone() },
    columnWidths: [],
  };
}

export function columnWidthMutation(change: ColumnWidthChange): GridMutation {
  return { label: "Resize column", cells: [], columnWidths: [change] };
}

export function isEmptyMutation(mutation: GridMutation): boolean {
  return mutation.cells.length === 0 && !mutation.formats && mutation.columnWidths.length === 0;
}

/** A grid mutation stamped for audit/provenance sinks. */
export type AuditedMutation = GridMutation & Readonly<{ at: string; revision?: string }>;

/** Receives every committed, undone, redone, or conflict-resolved mutation. Never blocks the commit. */
export type MutationAuditSink = (mutation: AuditedMutation) => void;

export function auditedMutation(mutation: GridMutation, revision?: string): AuditedMutation {
  return {
    ...mutation,
    cells: [...mutation.cells],
    columnWidths: [...mutation.columnWidths],
    at: new Date().toISOString(),
    ...(revision === undefined ? null : { revision }),
  };
}

/** Invokes the audit sink synchronously; sink errors are swallowed so commits never fail. */
export function emitMutationAudit(sink: MutationAuditSink | undefined, mutation: GridMutation, revision?: string): void {
  if (!sink) return;
  try {
    sink(auditedMutation(mutation, revision));
  } catch {
    // Audit sinks are best-effort provenance hooks; a throwing sink must not break the grid.
  }
}

export function applyCellMutation(
  data: ReadonlyMap<string, string>,
  mutation: GridMutation,
  direction: "forward" | "backward" = "forward",
): CellStore {
  return CellStore.from(data).apply(mutation.cells, direction);
}

export function applyWorksheetMutation(
  worksheet: Worksheet,
  mutation: GridMutation,
  direction: "forward" | "backward" = "forward",
): void {
  for (const change of mutation.cells) {
    const value = direction === "forward" ? change.after : change.before;
    if (value === undefined) worksheet.delete(change.address);
    else worksheet.setInput(change.address, value);
  }
}

export function applyColumnWidthMutation(
  widths: readonly number[],
  mutation: GridMutation,
  direction: "forward" | "backward" = "forward",
): number[] {
  if (mutation.columnWidths.length === 0) return [...widths];
  const next = [...widths];
  for (const change of mutation.columnWidths) {
    next[change.column] = direction === "forward" ? change.after : change.before;
  }
  return next;
}

export function mutationFormat(
  current: RangeStore<CellFormat>,
  mutation: GridMutation,
  direction: "forward" | "backward" = "forward",
): RangeStore<CellFormat> {
  if (!mutation.formats) return current;
  return (direction === "forward" ? mutation.formats.after : mutation.formats.before).clone();
}
