import type { CellBinding, Scalar } from "../engine";
import { parseAddress } from "../engine/coordinates";
import type { GridMutation } from "../grid/mutations";
import type { FilterClause, GroupNode, SortClause } from "./query";

export type RecordFieldBinding = Extract<CellBinding, { kind: "record-field" }>;

export type RecordFieldWrite = Readonly<{
  datasetId: string;
  recordId: string;
  fieldId: string;
  before?: string;
  after?: string;
}>;

export type CommitResult = Readonly<{
  revision: string;
  accepted: readonly RecordFieldWrite[];
  rejected: readonly { write: RecordFieldWrite; reason: string }[];
}>;

/** Boundary implemented by Postgres/API integrations, never by the renderer. */
export interface DataAdapter {
  resolve(binding: CellBinding): Scalar;
  commit(writes: readonly RecordFieldWrite[], baseRevision?: string): Promise<CommitResult>;
  createRecord?(datasetId: string, values: Readonly<Record<string, string>>, baseRevision?: string): Promise<Readonly<{ recordId: string; revision: string }>>;
}

export type PageRequest = Readonly<{
  datasetId: string;
  rowStart: number;
  rowCount: number;
  fieldIds: readonly string[];
  queryKey: string;
  revision?: string;
  sort?: readonly SortClause[];
  filters?: readonly FilterClause[];
  filterLogic?: "and" | "or";
  /** Authoritative over `filters`/`filterLogic` when present. */
  filterTree?: GroupNode;
}>;

export type DatasetPage = Readonly<{
  request: PageRequest;
  totalRows: number;
  revision: string;
  records: readonly Readonly<{
    recordId: string;
    values: Readonly<Record<string, Scalar>>;
  }>[];
}>;

export interface PagedDataAdapter extends DataAdapter {
  fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage>;
}

export function recordWritesForMutation(
  mutation: GridMutation,
  bindings: ReadonlyMap<string, CellBinding>,
): readonly RecordFieldWrite[] {
  const writes: RecordFieldWrite[] = [];
  for (const change of mutation.cells) {
    const binding = bindings.get(change.address);
    if (binding?.kind !== "record-field") continue;
    writes.push({
      datasetId: binding.datasetId,
      recordId: binding.recordId,
      fieldId: binding.fieldId,
      before: change.before,
      after: change.after,
    });
  }
  return writes;
}

/** The bound-header shape needed to derive writes from a mutation. */
export type MutationWriteHeader = Readonly<{
  datasetId?: string;
  recordIdForRow?(row: number): string | undefined;
  fields: readonly Readonly<{ id: string; column: number; writable?: boolean }>[];
}>;

/** A mutation cell's authoritative write, paired with its pre-edit value for UI reverts. */
export type MutationFieldWrite = Readonly<{
  write: Readonly<{
    address: string;
    row: number;
    datasetId?: string;
    recordId: string;
    fieldId: string;
    value: string;
  }>;
  before?: string;
}>;

/**
 * Derives the authoritative field writes for a grid mutation against a bound
 * header. Record identity comes from the header's row→record map rather than
 * worksheet cell bindings: editing a cell replaces its record-field binding
 * with a literal, so the header is the durable source across edits. Cells
 * without record identity (unbound grids, not-yet-loaded rows) and
 * non-writable fields produce no write; cleared cells write the empty string.
 */
export function fieldWritesForMutation(
  mutation: GridMutation,
  header: MutationWriteHeader | undefined,
): readonly MutationFieldWrite[] {
  if (!header) return [];
  const entries: MutationFieldWrite[] = [];
  for (const change of mutation.cells) {
    let point: ReturnType<typeof parseAddress>;
    try {
      point = parseAddress(change.address);
    } catch {
      continue;
    }
    const field = header.fields.find((item) => item.column === point.column);
    if (!field || field.writable === false) continue;
    const recordId = header.recordIdForRow?.(point.row);
    if (!recordId) continue;
    entries.push({
      write: {
        address: change.address,
        row: point.row,
        datasetId: header.datasetId,
        recordId,
        fieldId: field.id,
        value: change.after ?? "",
      },
      before: change.before,
    });
  }
  return entries;
}
