import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addressKey } from "../engine/coordinates";
import { DataPageCache } from "../data/page-cache";
import { RevisionedCommitCoordinator, conflictKey } from "../data/conflicts";
import { ViewportPageLoader, isAbortError } from "../data/viewport-loader";
import { materializeDatasetPage } from "../data/projection";
import { queryKey, type DatasetQuery } from "../data/query";
import type { PagedDataAdapter, RecordFieldWrite } from "../data/adapter";
import { cellChangesMutation, emitMutationAudit } from "../grid/mutations";
import { ConflictPanel, type ConflictPanelEntry } from "./ConflictPanel";
import { Spreadsheet, type FieldWrite, type SpreadsheetHandle, type SpreadsheetLoadingRange, type SpreadsheetProps, type SpreadsheetViewport } from "./Spreadsheet";

const adapterCaches = new WeakMap<object, DataPageCache>();

function sharedAdapterCache(adapter: object, maxPages: number) {
  const existing = adapterCaches.get(adapter);
  if (existing) return existing;
  const cache = new DataPageCache(maxPages);
  adapterCaches.set(adapter, cache);
  return cache;
}

export type PagedSpreadsheetProps = Omit<SpreadsheetProps,
  "initialData" | "bindingResolver" | "onViewportChange" | "onFieldWrite" | "onFieldWrites" | "onRecordCreate" | "sortMode" | "fieldIds"
> & Readonly<{
  adapter: PagedDataAdapter;
  datasetId: string;
  fieldIds: readonly string[];
  query?: DatasetQuery;
  pageSize?: number;
  prefetchPages?: number;
  cachePages?: number;
  onLoadError?(error: unknown): void;
  onTotalRowsChange?(totalRows: number): void;
  pageCache?: DataPageCache;
  showLoadStatus?: boolean;
  showLoadTimings?: boolean;
}>;

const defaultQuery = {};

/** Connects a single Spreadsheet renderer to a paged, revision-aware data adapter. */
export const PagedSpreadsheet = memo(forwardRef<SpreadsheetHandle, PagedSpreadsheetProps>(function PagedSpreadsheet(props, forwardedRef) {
  const {
    adapter,
    datasetId,
    fieldIds,
    query = defaultQuery,
    pageSize = 200,
    prefetchPages = 1,
    cachePages = 24,
    onLoadError,
    onTotalRowsChange,
    pageCache,
    showLoadStatus = true,
    showLoadTimings = false,
    onCellClickTiming,
    datasetHeader,
    ...spreadsheet
  } = props;
  const tableRef = useRef<SpreadsheetHandle>(null);
  const recordIdsRef = useRef(new Map<number, string>());
  const fallbackCache = useMemo(() => sharedAdapterCache(adapter, cachePages), [adapter, cachePages]);
  const cacheRef = useRef(pageCache ?? fallbackCache);
  const [coordinator] = useState(() => new RevisionedCommitCoordinator(adapter));
  const loadedPagesRef = useRef(new Map<number, number>());
  const initialLoadRef = useRef(true);
  const lastViewportRef = useRef<SpreadsheetViewport | null>(null);
  const [conflicts, setConflicts] = useState<readonly ConflictPanelEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const conflictTriggerRef = useRef<HTMLButtonElement>(null);
  const writeAddressesRef = useRef(new Map<string, string>());
  const auditRef = useRef(spreadsheet.onMutation);
  const renderFrameRef = useRef<number | undefined>(undefined);
  const [loadingRanges, setLoadingRanges] = useState<readonly SpreadsheetLoadingRange[]>([]);
  useEffect(() => { auditRef.current = spreadsheet.onMutation; });
  const [status, setStatus] = useState({ loading: false, loadedRows: 0, totalRows: spreadsheet.rowCount ?? 0, apiMs: 0, hydrationMs: 0, renderMs: 0, cellClickMs: 0 });
  const stableQueryKey = queryKey(query);
  const fieldIdKey = fieldIds.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: fieldIdKey is the content signature of fieldIds; the memo keeps a stable array across renders with equal contents
  const stableFieldIds = useMemo(() => [...fieldIds], [fieldIdKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stableQueryKey is the content signature of query; the loader rebuilds only when the query's meaning changes
  const loader = useMemo(() => new ViewportPageLoader(adapter, cacheRef.current, {
    datasetId,
    query,
    queryKey: stableQueryKey,
    pageSize,
    prefetchPages,
  }), [adapter, datasetId, pageSize, prefetchPages, stableQueryKey]);

  const composeRefs = useCallback((instance: SpreadsheetHandle | null) => {
    tableRef.current = instance;
    if (typeof forwardedRef === "function") forwardedRef(instance);
    else if (forwardedRef) forwardedRef.current = instance;
  }, [forwardedRef]);
  useEffect(() => () => loader.dispose(), [loader]);
  const previousQueryKeyRef = useRef(stableQueryKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-runs only when the query changes; it deliberately calls the current loadViewport rather than re-running on loader config changes
  useEffect(() => {
    const queryChanged = previousQueryKeyRef.current !== stableQueryKey;
    previousQueryKeyRef.current = stableQueryKey;
    recordIdsRef.current.clear();
    loadedPagesRef.current.clear();
    initialLoadRef.current = true;
    setStatus((current) => ({ ...current, loadedRows: 0 }));
    // Re-run the current viewport for the new query without remounting the grid.
    if (queryChanged && lastViewportRef.current) void loadViewport(lastViewportRef.current);
  }, [stableQueryKey]);
  useEffect(() => () => {
    if (renderFrameRef.current !== undefined && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(renderFrameRef.current);
  }, []);

  const loadViewport = useCallback(async (viewport: SpreadsheetViewport) => {
    const projected = { rowStart: viewport.rowStart, rowEnd: viewport.rowEnd, fieldIds: stableFieldIds };
    const initial = initialLoadRef.current;
    const requests = loader.requestsFor(projected, initial ? 0 : undefined);
    setLoadingRanges(requests.map((request) => ({
      rowStart: request.rowStart,
      rowEnd: request.rowStart + request.rowCount - 1,
      columnStart: 0,
      columnEnd: Math.max(0, stableFieldIds.length - 1),
    })));
    setStatus((current) => ({ ...current, loading: true }));
    try {
      const apiStart = performance.now();
      const pages = await loader.load(projected, initial ? 0 : undefined);
      const apiMs = performance.now() - apiStart;
      const hydrationStart = performance.now();
      const cells = new Map();
      let totalRows = 0;
      for (const page of pages) {
        coordinator.acceptRevision(page.revision);
        totalRows = page.totalRows;
        onTotalRowsChange?.(page.totalRows);
        loadedPagesRef.current.set(page.request.rowStart, page.records.length);
        page.records.forEach((record, offset) => { recordIdsRef.current.set(page.request.rowStart + offset, record.recordId); });
        for (const [address, cell] of materializeDatasetPage(page, stableFieldIds.map((fieldId, column) => ({ fieldId, column })))) cells.set(address, cell);
      }
      if (initial) tableRef.current?.replaceData(cells);
      else tableRef.current?.hydrate(cells);
      const hydrationMs = performance.now() - hydrationStart;
      const loadedRows = [...loadedPagesRef.current.values()].reduce((sum, count) => sum + count, 0);
      initialLoadRef.current = false;
      setLoadingRanges([]);
      setStatus((current) => ({ ...current, loading: false, loadedRows, totalRows, apiMs, hydrationMs, renderMs: 0 }));
      if (typeof requestAnimationFrame !== "undefined") {
        const renderStart = performance.now();
        renderFrameRef.current = requestAnimationFrame(() => {
          renderFrameRef.current = requestAnimationFrame(() => {
            setStatus((current) => ({ ...current, renderMs: performance.now() - renderStart }));
          });
        });
      }
    } catch (error) {
      if (isAbortError(error)) return;
      setLoadingRanges([]);
      setStatus((current) => ({ ...current, loading: false }));
      onLoadError?.(error);
    }
  }, [coordinator, loader, onLoadError, onTotalRowsChange, stableFieldIds]);

  const loadViewportRef = useRef(loadViewport);
  const handleViewportChange = useCallback((viewport: SpreadsheetViewport) => {
    lastViewportRef.current = viewport;
    void loadViewportRef.current(viewport);
  }, []);
  useEffect(() => { loadViewportRef.current = loadViewport; });

  const mergeConflicts = useCallback((entries: readonly ConflictPanelEntry[]) => {
    if (entries.length === 0) return;
    setConflicts((current) => {
      const next = new Map(current.map((entry) => [conflictKey(entry.conflict), entry]));
      for (const entry of entries) next.set(conflictKey(entry.conflict), entry);
      return [...next.values()];
    });
    setPanelOpen(true);
  }, []);

  const dropConflict = useCallback((entry: ConflictPanelEntry) => {
    const key = conflictKey(entry.conflict);
    setConflicts((current) => current.filter((candidate) => conflictKey(candidate.conflict) !== key));
  }, []);

  const addressFor = useCallback((write: RecordFieldWrite): string | undefined => {
    const direct = writeAddressesRef.current.get(JSON.stringify([write.recordId, write.fieldId]));
    if (direct) return direct;
    for (const [row, recordId] of recordIdsRef.current) {
      if (recordId !== write.recordId) continue;
      const column = stableFieldIds.indexOf(write.fieldId);
      if (column >= 0) return addressKey({ row, column });
    }
    return undefined;
  }, [stableFieldIds]);

  const writeField = async (write: FieldWrite) => {
    if (!write.recordId) throw new Error("Record identity is missing");
    writeAddressesRef.current.set(JSON.stringify([write.recordId, write.fieldId]), write.address);
    const recordWrite: RecordFieldWrite = {
      datasetId: write.datasetId ?? datasetId,
      recordId: write.recordId,
      fieldId: write.fieldId,
      after: write.value,
    };
    const result = await coordinator.commit([recordWrite]);
    if (result.status === "conflict") {
      mergeConflicts(result.conflicts.map((conflict) => ({ conflict, write: conflict.write, currentRevision: result.currentRevision })));
      throw Object.assign(new Error("Revision conflict"), { status: 409, conflict: result });
    }
    if (result.result.rejected.length) throw new Error(result.result.rejected[0]?.reason);
    // Drop cached pages so the next viewport load can't serve pre-edit values
    // (and can't rewind the coordinator revision with a stale page).
    cacheRef.current.invalidateDataset(recordWrite.datasetId);
  };

  /** Bulk edits land as one coordinator commit so the adapter sees a single mutation. */
  const writeFields = async (writes: readonly FieldWrite[]) => {
    const recordWrites: RecordFieldWrite[] = [];
    for (const write of writes) {
      if (!write.recordId) continue;
      writeAddressesRef.current.set(JSON.stringify([write.recordId, write.fieldId]), write.address);
      recordWrites.push({
        datasetId: write.datasetId ?? datasetId,
        recordId: write.recordId,
        fieldId: write.fieldId,
        after: write.value,
      });
    }
    if (!recordWrites.length) return;
    const result = await coordinator.commit(recordWrites);
    if (result.status === "conflict") {
      mergeConflicts(result.conflicts.map((conflict) => ({ conflict, write: conflict.write, currentRevision: result.currentRevision })));
      throw Object.assign(new Error("Revision conflict"), { status: 409, conflict: result });
    }
    if (result.result.rejected.length) throw new Error(result.result.rejected[0]?.reason);
    for (const id of new Set(recordWrites.map((write) => write.datasetId))) cacheRef.current.invalidateDataset(id);
  };

  const keepMine = useCallback(async (entry: ConflictPanelEntry) => {
    coordinator.acceptRevision(entry.currentRevision);
    const result = await coordinator.commit([entry.write]);
    if (result.status === "conflict") {
      mergeConflicts(result.conflicts.map((conflict) => ({ conflict, write: conflict.write, currentRevision: result.currentRevision })));
      return;
    }
    if (result.result.rejected.length) return;
    dropConflict(entry);
    cacheRef.current.invalidateDataset(entry.write.datasetId);
    const address = addressFor(entry.write);
    if (address) {
      tableRef.current?.clearWriteState(address);
      emitMutationAudit(auditRef.current, cellChangesMutation("Keep mine (conflict resolved)", [{
        address,
        before: entry.conflict.serverValue,
        after: entry.write.after,
      }]), result.result.revision);
    }
  }, [addressFor, coordinator, dropConflict, mergeConflicts]);

  const takeServer = useCallback((entry: ConflictPanelEntry) => {
    const address = addressFor(entry.write);
    if (address) {
      tableRef.current?.hydrate(new Map([[address, {
        display: entry.conflict.serverValue ?? "",
        binding: { kind: "record-field" as const, datasetId: entry.write.datasetId, recordId: entry.write.recordId, fieldId: entry.write.fieldId },
      }]]));
      tableRef.current?.clearWriteState(address);
      emitMutationAudit(auditRef.current, cellChangesMutation("Take server (conflict resolved)", [{
        address,
        before: entry.write.after,
        after: entry.conflict.serverValue,
      }]), entry.currentRevision);
    }
    dropConflict(entry);
    // The server value now wins; cached pages may still hold the pre-conflict
    // value, so the next fetch must not serve them.
    cacheRef.current.invalidateDataset(entry.write.datasetId);
  }, [addressFor, dropConflict]);

  const keepAllMine = useCallback(async () => {
    for (const entry of conflicts) await keepMine(entry);
  }, [conflicts, keepMine]);

  const takeAllServer = useCallback(() => {
    for (const entry of conflicts) takeServer(entry);
  }, [conflicts, takeServer]);

  const fieldLabels = useMemo(() => {
    const fields = datasetHeader?.fields ?? [];
    return new Map(fields.map((field) => [field.id, field.label] as const));
  }, [datasetHeader]);

  const createRecord = async ({ row, values }: Readonly<{ row: number; values: Readonly<Record<string, string>> }>) => {
    if (!adapter.createRecord) throw new Error("This adapter does not support record creation");
    const created = await adapter.createRecord(datasetId, values, coordinator.revision);
    recordIdsRef.current.set(row, created.recordId);
    coordinator.acceptRevision(created.revision);
    cacheRef.current.invalidateDataset(datasetId);
    const cells = new Map(stableFieldIds.map((fieldId, column) => [addressKey({ row, column }), {
      display: values[fieldId] ?? "",
      binding: { kind: "record-field" as const, datasetId, recordId: created.recordId, fieldId },
    }]));
    tableRef.current?.hydrate(cells);
  };

  return <div className="paged-spreadsheet">
    <Spreadsheet
      {...spreadsheet}
      ref={composeRefs}
      initialData={new Map()}
      datasetHeader={datasetHeader ? { ...datasetHeader, datasetId, recordIdForRow: (row) => recordIdsRef.current.get(row) ?? datasetHeader.recordIdForRow?.(row) } : undefined}
      fieldIds={stableFieldIds}
      query={query}
      sortMode="server"
      loadingRanges={loadingRanges}
      bindingResolver={(binding) => adapter.resolve(binding)}
      onViewportChange={handleViewportChange}
      onFieldWrite={writeField}
      onFieldWrites={writeFields}
      onRecordCreate={createRecord}
      onCellClickTiming={(milliseconds) => {
        if (showLoadTimings) setStatus((current) => ({ ...current, cellClickMs: milliseconds }));
        onCellClickTiming?.(milliseconds);
      }}
    />
    {showLoadStatus && <output className="paged-status" aria-live="polite">
      <span>{status.loading ? "Loading · " : ""}{status.loadedRows.toLocaleString()} / {status.totalRows.toLocaleString()} rows loaded</span>
      {showLoadTimings && (status.apiMs > 0 || status.hydrationMs > 0) && <small>API {status.apiMs.toFixed(0)} ms · hydrate {status.hydrationMs.toFixed(0)} ms · render {status.renderMs.toFixed(0)} ms{status.cellClickMs > 0 ? ` · click ${status.cellClickMs.toFixed(1)} ms` : ""}</small>}
    </output>}
    {conflicts.length > 0 && <button type="button"
      ref={conflictTriggerRef}
      className="conflict-toggle"
      aria-expanded={panelOpen}
      aria-haspopup="dialog"
      onClick={() => setPanelOpen((open) => !open)}
    >Conflicts ({conflicts.length})</button>}
    {panelOpen && conflicts.length > 0 && <ConflictPanel
      conflicts={conflicts}
      fieldLabels={fieldLabels}
      trigger={conflictTriggerRef}
      onKeepMine={(entry) => { void keepMine(entry); }}
      onTakeServer={takeServer}
      onKeepAll={() => { void keepAllMine(); }}
      onTakeAll={takeAllServer}
      onClose={() => setPanelOpen(false)}
    />}
  </div>;
}));
