import type { CellBinding, Scalar } from "../engine";
import type {
  CommitResult,
  DatasetPage,
  PageRequest,
  PagedDataAdapter,
  RecordFieldWrite,
} from "./adapter";
import { RevisionConflictError, type RevisionConflict } from "./conflicts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

function valueKey(datasetId: string, recordId: string, fieldId: string): string {
  return `${datasetId}\u0000${recordId}\u0000${fieldId}`;
}

/** JSON-over-HTTP implementation of the renderer's structured-data boundary. */
export class HttpPagedDataAdapter implements PagedDataAdapter {
  readonly #values = new Map<string, Scalar>();

  constructor(
    readonly baseUrl: string,
    readonly fetcher: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  resolve(binding: CellBinding): Scalar {
    if (binding.kind !== "record-field") return null;
    return this.#values.get(valueKey(binding.datasetId, binding.recordId, binding.fieldId)) ?? null;
  }

  async fetchPage(request: PageRequest, signal?: AbortSignal): Promise<DatasetPage> {
    const query = new URLSearchParams({
      datasetId: request.datasetId,
      rowStart: String(request.rowStart),
      rowCount: String(request.rowCount),
      fieldIds: request.fieldIds.join(","),
      queryKey: request.queryKey,
    });
    if (request.revision) query.set("revision", request.revision);
    if (request.sort?.length) query.set("sort", JSON.stringify(request.sort));
    if (request.filters?.length) query.set("filters", JSON.stringify(request.filters));
    if (request.filterLogic) query.set("filterLogic", request.filterLogic);
    if (request.filterTree) query.set("filterTree", JSON.stringify(request.filterTree));
    const response = await this.fetcher(`${this.baseUrl}/pages?${query}`, { signal });
    if (!response.ok) throw new Error(`Page request failed (${response.status})`);
    const data: unknown = await response.json();
    if (!isDatasetPage(data)) throw new Error("Malformed page response");
    const page = data;
    for (const record of page.records) {
      for (const [fieldId, value] of Object.entries(record.values)) {
        this.#values.set(valueKey(request.datasetId, record.recordId, fieldId), value);
      }
    }
    return page;
  }

  async commit(writes: readonly RecordFieldWrite[], baseRevision?: string): Promise<CommitResult> {
    const response = await this.fetcher(`${this.baseUrl}/commits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ writes, baseRevision }),
    });
    if (!response.ok && response.status === 409) {
      const conflict: unknown = await response.json();
      if (isConflictBody(conflict)) throw new RevisionConflictError(conflict.currentRevision, conflict.conflicts);
      // A conflict that can't be parsed surfaces as a failure, not a crash
      // downstream in conflicts.map.
      throw new Error("Commit failed (409)");
    }
    if (!response.ok) throw new Error(`Commit failed (${response.status})`);
    const result = await response.json() as CommitResult;
    for (const write of result.accepted) {
      this.#values.set(valueKey(write.datasetId, write.recordId, write.fieldId), write.after ?? null);
    }
    return result;
  }

  async createRecord(datasetId: string, values: Readonly<Record<string, string>>, baseRevision?: string): Promise<Readonly<{ recordId: string; revision: string }>> {
    const response = await this.fetcher(`${this.baseUrl}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datasetId, values, baseRevision }),
    });
    if (!response.ok && response.status === 409) {
      const conflict: unknown = await response.json();
      if (isConflictBody(conflict)) throw new RevisionConflictError(conflict.currentRevision, conflict.conflicts);
      throw new Error("Record creation failed (409)");
    }
    if (!response.ok) throw new Error(`Record creation failed (${response.status})`);
    return response.json() as Promise<Readonly<{ recordId: string; revision: string }>>;
  }
}
function isDatasetPage(data: unknown): data is DatasetPage {
  if (!data || typeof data !== "object") return false;
  const page = data as { request?: { fieldIds?: unknown }; records?: unknown };
  return !!page.request && Array.isArray(page.request.fieldIds) && Array.isArray(page.records);
}

function isConflictBody(data: unknown): data is { currentRevision: string; conflicts: readonly RevisionConflict[] } {
  if (!data || typeof data !== "object") return false;
  const body = data as { currentRevision?: unknown; conflicts?: unknown };
  return typeof body.currentRevision === "string" && Array.isArray(body.conflicts)
    && body.conflicts.every((entry: unknown) => !!entry && typeof entry === "object"
      && typeof (entry as { write?: { recordId?: unknown; fieldId?: unknown } }).write?.recordId === "string"
      && typeof (entry as { write?: { recordId?: unknown; fieldId?: unknown } }).write?.fieldId === "string");
}
