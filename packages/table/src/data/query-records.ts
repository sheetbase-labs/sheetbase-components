import type { PagedDataAdapter, PageRequest } from "./adapter";
import type { DataPageCache } from "./page-cache";
import { queryKey } from "./query";
import type { AsyncFunction } from "../engine/async-functions";
import type { SpillMatrix } from "../engine/spill-store";
import type { Scalar } from "../engine/types";
import type { FunctionArg } from "../engine/functions";

/** Default row cap when the formula doesn't pass a third argument. */
const QUERY_RECORDS_DEFAULT_LIMIT = 100;

function textArg(arg: FunctionArg | undefined): string {
  if (typeof arg !== "string" || arg === "") throw new Error(`#VALUE!`);
  return arg;
}

/**
 * The real `QUERYRECORDS` transport: `QUERYRECORDS(datasetId, fieldId, [limit])`
 * fetches one page through the host's `PagedDataAdapter` and spills the
 * field's values down a single column.
 *
 * Semantics:
 * - `datasetId` and `fieldId` are required strings; `limit` defaults to 100.
 * - An empty result raises `#N/A` — the same convention lookup misses use.
 * - Requests omit `revision` (always latest), so N formulas over the same
 *   `(dataset, field, limit)` share one `DataPageCache` entry and one fetch.
 *   When the adapter's revision advances, the host calls
 *   `cache.invalidateDataset(datasetId)` plus `worksheet.invalidate` on every
 *   `executor.asyncAddresses()` entry, then re-runs `recalculateAsync` —
 *   coarse, whole-dataset invalidation by design for the spike.
 */
export function createQueryRecordsTransport(adapter: PagedDataAdapter, cache?: DataPageCache): AsyncFunction {
  return async (args) => {
    const datasetId = textArg(args[0]);
    const fieldId = textArg(args[1]);
    const limitArg = args[2];
    if (limitArg !== undefined && limitArg !== null && limitArg !== "" && (typeof limitArg !== "number" || !Number.isInteger(limitArg) || limitArg <= 0)) {
      throw new Error("#VALUE!");
    }
    const limit = typeof limitArg === "number" ? limitArg : QUERY_RECORDS_DEFAULT_LIMIT;
    const request: PageRequest = {
      datasetId,
      rowStart: 0,
      rowCount: limit,
      fieldIds: [fieldId],
      queryKey: queryKey({}),
    };
    const page = cache
      ? await cache.getOrLoad(request, () => adapter.fetchPage(request))
      : await adapter.fetchPage(request);
    if (page.records.length === 0) throw new Error("#N/A");
    const values: Scalar[][] = page.records.map((record) => [record.values[fieldId] ?? null]);
    const spill: SpillMatrix = { kind: "spill", values };
    return spill;
  };
}
