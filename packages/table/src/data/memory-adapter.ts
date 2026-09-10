import { testCondition } from "sheetbase-shared";
import type { CellBinding, Scalar } from "../engine";
import type { CommitResult, DatasetPage, PageRequest, PagedDataAdapter, RecordFieldWrite } from "./adapter";

export interface MemoryDatasetRow {
  recordId: string;
  values: Record<string, Scalar>;
}

/**
 * In-memory `PagedDataAdapter` for examples and tests: applies the request's
 * filters/sort, then paginates. Edits via `commit` mutate the in-memory rows.
 */
export function createMemoryPagedAdapter(rows: readonly MemoryDatasetRow[], initialRevision = "1"): PagedDataAdapter {
  let records = rows.map((row) => ({ recordId: row.recordId, values: { ...row.values } }));
  let revision = initialRevision;

  return {
    resolve(binding: CellBinding): Scalar {
      if (binding.kind !== "record-field") return null;
      return records.find((record) => record.recordId === binding.recordId)?.values[binding.fieldId] ?? null;
    },

    async fetchPage(request: PageRequest): Promise<DatasetPage> {
      const filters = request.filters ?? [];
      let filtered = filters.length === 0
        ? [...records]
        : records.filter((record) => (request.filterLogic ?? "and") === "or"
          ? filters.some((clause) => testCondition(record.values, clause))
          : filters.every((clause) => testCondition(record.values, clause)));

      const sort = request.sort ?? [];
      if (sort.length > 0) {
        filtered = [...filtered].sort((a, b) => {
          for (const clause of sort) {
            const av = a.values[clause.fieldId];
            const bv = b.values[clause.fieldId];
            const an = typeof av === "number" ? av : Number(av);
            const bn = typeof bv === "number" ? bv : Number(bv);
            const comparable = Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "";
            const cmp = comparable ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
            if (cmp !== 0) return clause.direction === "desc" ? -cmp : cmp;
          }
          return 0;
        });
      }

      return {
        request,
        totalRows: filtered.length,
        revision,
        records: filtered.slice(request.rowStart, request.rowStart + request.rowCount),
      };
    },

    async commit(writes: readonly RecordFieldWrite[]): Promise<CommitResult> {
      const accepted: RecordFieldWrite[] = [];
      for (const write of writes) {
        const record = records.find((candidate) => candidate.recordId === write.recordId);
        if (!record) continue;
        record.values = { ...record.values, [write.fieldId]: write.after ?? "" };
        accepted.push(write);
      }
      revision = String((Number(revision) || 0) + 1);
      return { revision, accepted, rejected: [] };
    },
  };
}
