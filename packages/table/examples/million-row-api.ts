import { Database } from "bun:sqlite";
// Filter trees are evaluated with the shared predicate so example semantics
// can't drift from the contract. Requires `bun run build:lib` in packages/shared
// first (the workspace import resolves to dist-lib).
import { buildPredicate, type FilterNode } from "sheetbase-shared";
import { DATASET_COLUMNS, createDataset, filterTreeToSql, filtersToSql, insertRecord, quoteField, sortToSql } from "./sql-engine";

// Two engines serve the same wire contract. The default `sql` engine seeds a
// real SQLite table (SQL_ROWS rows, default 250k) and answers filtered/
// sorted/aggregated/commits through the filterTree→SQL compiler in
// sql-engine.ts — the reference host executor. `API_ENGINE=memory` keeps the
// original all-JS million-row behaviour for the scroll-perf demo. In SQL mode
// unfiltered+unsorted page requests still serve generated rows (the fast
// path); overrides/created are mirrored into the table on every write so the
// two representations never diverge.
type Scalar = string | number | boolean | null;
type RecordRow = { recordId: string; values: Record<string, Scalar> };
type Write = { datasetId: string; recordId: string; fieldId: string; before?: string; after?: string };

const TOTAL_ROWS = 1_000_000;
const PORT = Number(process.env.SHEETBASE_API_PORT ?? 8787);
const SQL_MODE = process.env.API_ENGINE !== "memory";
const SQL_ROWS = Number(process.env.SQL_ROWS ?? 250_000);
const DATASET_ROWS = SQL_MODE ? SQL_ROWS : TOTAL_ROWS;
const overrides = new Map<string, Record<string, Scalar>>();
const created: RecordRow[] = [];
let revision = 1;

function generated(index: number): RecordRow {
  const number = index + 1;
  const statuses = ["Complete", "Review", "Flagged"];
  const assays = ["p24 ELISA", "Residual DNA", "Vector ID", "BCA", "HCP", "PicoGreen", "Benzonase"];
  const reviewers = ["Alice Chen", "David Okafor", "Maya Singh", null];
  const base: Record<string, Scalar> = {
    experiment_id: `EXP-${String(number).padStart(7, "0")}`,
    sample_id: `SMP-${String(number * 3).padStart(7, "0")}`,
    assay: assays[index % assays.length],
    result: Number((((index * 48271) % 100000) / 1000).toFixed(3)),
    unit: index % 4 === 0 ? "Ct" : "ng/mL",
    run_date: new Date(Date.UTC(2026, 0, 1 + index % 365)).toISOString().slice(0, 10),
    status: statuses[index % statuses.length],
    reviewer: reviewers[index % reviewers.length],
    approved: index % 5 === 0,
  };
  return { recordId: `record-${number}`, values: { ...base, ...overrides.get(`record-${number}`) } };
}

function compare(a: Scalar, b: Scalar): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function matches(value: Scalar, filter: { operator: string; value?: unknown }): boolean {
  const expected = filter.value as Scalar;
  if (filter.operator === "isNull") return value === null || value === "";
  if (filter.operator === "notNull") return !(value === null || value === "");
  if (filter.operator === "eq") return value === expected;
  if (filter.operator === "neq") return value !== expected;
  if (filter.operator === "contains") return String(value ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  if (filter.operator === "startsWith") return String(value ?? "").toLowerCase().startsWith(String(expected ?? "").toLowerCase());
  if (filter.operator === "endsWith") return String(value ?? "").toLowerCase().endsWith(String(expected ?? "").toLowerCase());
  if (filter.operator === "in") return Array.isArray(filter.value) && filter.value.includes(value);
  if (filter.operator === "between") {
    const [min, max] = Array.isArray(filter.value) ? filter.value : [];
    const orderMin = compare(value, min ?? null);
    const orderMax = compare(value, max ?? null);
    return orderMin >= 0 && orderMax <= 0;
  }
  if (filter.operator === "withinLastDays") {
    // Calendar days inclusive of today; the shared predicate mirrors this definition.
    const days = Number(filter.value);
    if (!Number.isFinite(days) || days <= 0) return false;
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const text = String(value ?? "");
    return text >= start && text <= today;
  }
  const order = compare(value, expected);
  return filter.operator === "gt" ? order > 0 : filter.operator === "gte" ? order >= 0 : filter.operator === "lt" ? order < 0 : order <= 0;
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" } });
}

function conflict(writes: Write[]): Response {
  return json({ currentRevision: `r${revision}`, conflicts: writes.map((write) => ({ write, serverValue: overrides.get(write.recordId)?.[write.fieldId], reason: "The record changed after this page was loaded." })) }, 409);
}

// Presentation state persists per user in a local SQLite file; replace with a
// database-backed table (keyed by user and dataset) in production.
const presentationDb = new Database("presentation.db", { create: true });
presentationDb.run("CREATE TABLE IF NOT EXISTS presentations (key TEXT PRIMARY KEY, state TEXT NOT NULL)");
const savePresentation = presentationDb.prepare("INSERT INTO presentations (key, state) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET state = excluded.state");
const loadPresentation = presentationDb.prepare("SELECT state FROM presentations WHERE key = ?");

// SQL-mode dataset: same generated() bytes the memory engine serves, in a
// real table the filterTree→SQL compiler queries.
const datasetDb = SQL_MODE ? new Database(":memory:") : null;
if (datasetDb) createDataset(datasetDb, SQL_ROWS, generated);

type FlatFilter = { fieldId: string; operator: string; value?: unknown };
type SortSpec = { fieldId: string; direction: "asc" | "desc" };

/** The in-memory filtered/sorted page — the canonical engine. */
function jsPage(treePredicate: ((row: Record<string, Scalar>) => boolean) | null, filters: FlatFilter[], filterLogic: "and" | "or", sort: SortSpec[], rowStart: number, rowCount: number): { records: RecordRow[]; totalRows: number } {
  const candidateCount = DATASET_ROWS + created.length;
  const candidates: RecordRow[] = [];
  for (let index = 0; index < candidateCount; index++) {
    const row = index < DATASET_ROWS ? generated(index) : created[index - DATASET_ROWS];
    const keep = treePredicate
      ? treePredicate(row.values)
      : (filterLogic === "or" ? filters.some((filter) => matches(row.values[filter.fieldId] ?? null, filter)) : filters.every((filter) => matches(row.values[filter.fieldId] ?? null, filter)));
    if (keep) candidates.push(row);
  }
  if (sort.length) candidates.sort((left, right) => {
    for (const clause of sort) {
      const order = compare(left.values[clause.fieldId] ?? null, right.values[clause.fieldId] ?? null);
      if (order) return clause.direction === "asc" ? order : -order;
    }
    return left.recordId.localeCompare(right.recordId);
  });
  return { records: candidates.slice(rowStart, rowStart + rowCount), totalRows: candidates.length };
}

/** The same page via the SQL compiler — the reference host executor. */
function sqlPage(db: Database, filterTreeParam: string | null, filters: FlatFilter[], filterLogic: "and" | "or", sort: SortSpec[], fieldIds: string[], rowStart: number, rowCount: number): { records: RecordRow[]; totalRows: number } {
  const where = filterTreeParam
    ? filterTreeToSql(JSON.parse(filterTreeParam) as FilterNode)
    : filtersToSql(filters, filterLogic);
  const known = new Set<string>(DATASET_COLUMNS);
  const projected = fieldIds.filter((fieldId) => known.has(fieldId));
  const rows = db.prepare(
    `SELECT record_id${projected.length ? `, ${projected.map(quoteField).join(", ")}` : ""} FROM records WHERE ${where.sql} ORDER BY ${sortToSql(sort)} LIMIT ? OFFSET ?`,
  ).all(...where.params, rowCount, rowStart);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM records WHERE ${where.sql}`).get(...where.params);
  return {
    records: rows.map((row) => ({
      recordId: String(row.record_id),
      // Unknown fieldIds project as null — same as the memory engine's `?? null`.
      values: Object.fromEntries(fieldIds.map((fieldId) => [fieldId, row[fieldId] ?? null])),
    })),
    totalRows: Number(total?.c ?? 0),
  };
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,PUT,OPTIONS" } });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/table/pages") {
      const rowStart = Math.max(0, Number(url.searchParams.get("rowStart") ?? 0));
      const rowCount = Math.min(500, Math.max(1, Number(url.searchParams.get("rowCount") ?? 200)));
      const fieldIds = (url.searchParams.get("fieldIds") ?? "").split(",").filter(Boolean);
      const filters = JSON.parse(url.searchParams.get("filters") ?? "[]") as FlatFilter[];
      const filterLogic = url.searchParams.get("filterLogic") === "or" ? "or" : "and";
      const filterTreeParam = url.searchParams.get("filterTree");
      // A filter tree is authoritative over the flat clauses when present.
      const treePredicate = filterTreeParam ? buildPredicate(JSON.parse(filterTreeParam) as FilterNode) : null;
      const sort = JSON.parse(url.searchParams.get("sort") ?? "[]") as SortSpec[];
      const echo = { datasetId: "experiments", rowStart, rowCount, fieldIds, queryKey: url.searchParams.get("queryKey") ?? "", sort, filters, filterLogic, ...(filterTreeParam ? { filterTree: JSON.parse(filterTreeParam) } : {}) };
      // ?engine=compare runs both engines on the same request and reports
      // any divergence — the executable proof that sql-engine mirrors
      // buildPredicate. Dev-only: the JS side scans the whole dataset.
      if (datasetDb && url.searchParams.get("engine") === "compare" && (treePredicate || filters.length || sort.length)) {
        const js = jsPage(treePredicate, filters, filterLogic, sort, rowStart, rowCount);
        const sql = sqlPage(datasetDb, filterTreeParam, filters, filterLogic, sort, fieldIds, rowStart, rowCount);
        const jsIds = js.records.map((record) => record.recordId).sort();
        const sqlIds = sql.records.map((record) => record.recordId).sort();
        const divergence = js.totalRows !== sql.totalRows || jsIds.join("") !== sqlIds.join("");
        if (divergence) {
          console.warn(`engine divergence: js=${js.totalRows}/${jsIds.length} sql=${sql.totalRows}/${sqlIds.length}`);
          return json({ divergence: { js: { totalRows: js.totalRows, ids: jsIds }, sql: { totalRows: sql.totalRows, ids: sqlIds } } }, 409);
        }
      }
      const candidateCount = DATASET_ROWS + created.length;
      let totalRows = candidateCount;
      let records: RecordRow[];
      if (!treePredicate && !filters.length && !sort.length) {
        records = Array.from({ length: Math.min(rowCount, Math.max(0, candidateCount - rowStart)) }, (_, offset) => {
          const index = rowStart + offset;
          return index < DATASET_ROWS ? generated(index) : created[index - DATASET_ROWS];
        });
      } else if (datasetDb) {
        const page = sqlPage(datasetDb, filterTreeParam, filters, filterLogic, sort, fieldIds, rowStart, rowCount);
        totalRows = page.totalRows;
        records = page.records;
      } else {
        const page = jsPage(treePredicate, filters, filterLogic, sort, rowStart, rowCount);
        totalRows = page.totalRows;
        records = page.records;
      }
      const projected = records.map((row) => ({ recordId: row.recordId, values: Object.fromEntries(fieldIds.map((fieldId) => [fieldId, row.values[fieldId] ?? null])) }));
      return json({ request: echo, totalRows, revision: `r${revision}`, records: projected });
    }
    if (request.method === "POST" && url.pathname === "/api/table/commits") {
      const body = await request.json() as { writes: Write[]; baseRevision?: string };
      if (body.baseRevision && body.baseRevision !== `r${revision}`) return conflict(body.writes);
      for (const write of body.writes) {
        if (datasetDb && (DATASET_COLUMNS as readonly string[]).includes(write.fieldId)) {
          const value = write.fieldId === "approved" ? (write.after === "true" || write.after === "1" ? 1 : 0) : (write.after ?? null);
          datasetDb.prepare(`UPDATE records SET ${quoteField(write.fieldId)} = ? WHERE record_id = ?`).run(value, write.recordId);
        }
        // Keep the generated fast path in sync with the table.
        const createdRow = created.find((row) => row.recordId === write.recordId);
        if (createdRow) createdRow.values[write.fieldId] = write.after ?? null;
        else overrides.set(write.recordId, { ...overrides.get(write.recordId), [write.fieldId]: write.after ?? null });
      }
      revision++;
      return json({ revision: `r${revision}`, accepted: body.writes, rejected: [] });
    }
    if (request.method === "POST" && url.pathname === "/api/table/records") {
      const body = await request.json() as { datasetId: string; values: Record<string, Scalar>; baseRevision?: string };
      if (body.baseRevision && body.baseRevision !== `r${revision}`) return conflict([]);
      const recordId = `created-${created.length + 1}`;
      created.push({ recordId, values: body.values });
      if (datasetDb) insertRecord(datasetDb, recordId, body.values);
      revision++;
      return json({ recordId, revision: `r${revision}` }, 201);
    }
    if (request.method === "POST" && url.pathname === "/api/table/conflict") { revision++; return json({ revision: `r${revision}` }); }
    if (request.method === "POST" && url.pathname === "/api/explorer/aggregate") {
      // Explorer spike endpoint: server-side group+aggregate so charts work
      // without materialising rows. Filter payload is the plan-008 tree.
      const body = await request.json() as { datasetId?: string; filter?: FilterNode; groupBy?: string; seriesBy?: string[]; summary?: string; valueField?: string; limit?: number };
      if (!body.groupBy || !body.summary) return json({ error: "groupBy and summary are required" }, 400);
      if (body.summary !== "count" && body.valueField === undefined) return json({ error: "valueField is required for this summary" }, 400);
      const seriesBy = (Array.isArray(body.seriesBy) ? body.seriesBy.filter((field): field is string => typeof field === "string" && field !== body.groupBy) : [])
        .filter((field) => !datasetDb || (DATASET_COLUMNS as readonly string[]).includes(field));
      if (datasetDb) {
        // SQL engine: one GROUP BY over the (key × series) tuple. Median has
        // no SQLite aggregate — each bucket's ordered values come back in a
        // second pass (capped at MEDIAN_CAP; a production backend uses an
        // approximate quantile).
        const where = body.filter ? filterTreeToSql(body.filter) : { sql: "(1=1)", params: [] as (string | number | null)[] };
        const groupByField = body.groupBy;
        const dims = [groupByField, ...seriesBy];
        const cols = dims.map(quoteField);
        const valueCol = body.valueField ? quoteField(body.valueField) : null;
        const aggExpr = body.summary === "count" ? "COUNT(*)" : body.summary === "median" ? null : `${{ mean: "AVG", sum: "SUM", min: "MIN", max: "MAX" }[body.summary as "mean" | "sum" | "min" | "max"]}(${valueCol})`;
        const rows = datasetDb.prepare(
          `SELECT ${cols.join(", ")}, COUNT(*) AS _n${aggExpr ? `, ${aggExpr} AS _v` : ""} FROM records WHERE ${where.sql} GROUP BY ${cols.join(", ")} ORDER BY ${cols.join(", ")}`,
        ).all(...where.params);
        const total = datasetDb.prepare(`SELECT COUNT(*) AS c FROM records WHERE ${where.sql}`).get(...where.params);
        const MEDIAN_CAP = 100_000;
        const buckets = rows.map((row) => {
          const key = String(row[groupByField] ?? "");
          const series = seriesBy.length ? Object.fromEntries(seriesBy.map((field) => [field, String(row[field] ?? "")])) : undefined;
          const count = Number(row._n);
          let value: number | null = null;
          if (body.summary === "count") value = count;
          else if (aggExpr) value = row._v === null || row._v === undefined ? null : Number(row._v);
          else if (valueCol) {
            // Exact per-bucket median: ordered values, capped.
            const dimConds = dims.map((field, i) => row[field] === null || row[field] === undefined ? `${cols[i]} IS NULL` : `${cols[i]} = ?`);
            const dimParams = dims.map((field) => row[field]).filter((v) => v !== null && v !== undefined) as (string | number)[];
            const values = datasetDb.prepare(
              `SELECT ${valueCol} AS v FROM records WHERE ${where.sql} AND ${dimConds.join(" AND ")} AND ${valueCol} IS NOT NULL ORDER BY ${valueCol} LIMIT ?`,
            ).all(...where.params, ...dimParams, MEDIAN_CAP).map((r) => Number(r.v));
            if (values.length) {
              const middle = Math.floor(values.length / 2);
              const lo = values[values.length % 2 ? middle : middle - 1] ?? 0;
              const hi = values[middle] ?? 0;
              value = values.length % 2 ? hi : (lo + hi) / 2;
            }
          }
          return { key, ...(series ? { series } : {}), count, value };
        });
        const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : undefined;
        return json({ buckets: limit ? buckets.slice(0, limit) : buckets, totalRows: Number(total?.c ?? 0), revision: `r${revision}` });
      }
      const predicate = body.filter ? buildPredicate(body.filter) : () => true;
      const buckets = new Map<string, { key: string; series?: Record<string, string>; count: number; values: number[] }>();
      let matched = 0;
      const candidateCount = DATASET_ROWS + created.length;
      for (let index = 0; index < candidateCount; index++) {
        const row = index < DATASET_ROWS ? generated(index) : created[index - DATASET_ROWS];
        if (!predicate(row.values)) continue;
        matched++;
        const key = String(row.values[body.groupBy] ?? "");
        const seriesValues = seriesBy.map((field) => row.values[field]);
        const mapKey = seriesBy.length ? JSON.stringify([key, ...seriesValues]) : key;
        let bucket = buckets.get(mapKey);
        if (!bucket) {
          bucket = {
            key,
            ...(seriesBy.length ? { series: Object.fromEntries(seriesBy.map((field, fieldIndex) => [field, String(seriesValues[fieldIndex] ?? "")])) } : {}),
            count: 0,
            values: [],
          };
          buckets.set(mapKey, bucket);
        }
        bucket.count++;
        if (body.valueField !== undefined) {
          const value = Number(row.values[body.valueField]);
          if (Number.isFinite(value)) bucket.values.push(value);
        }
      }
      const summarized = [...buckets.values()].map((bucket) => {
        let value: number | null = null;
        if (body.summary === "count") value = bucket.count;
        else if (bucket.values.length) {
          if (body.summary === "sum") value = bucket.values.reduce((sum, item) => sum + item, 0);
          else if (body.summary === "mean") value = bucket.values.reduce((sum, item) => sum + item, 0) / bucket.values.length;
          else if (body.summary === "min") value = Math.min(...bucket.values);
          else if (body.summary === "max") value = Math.max(...bucket.values);
          else if (body.summary === "median") {
            const sorted = [...bucket.values].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            value = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
          }
        }
        return { key: bucket.key, ...(bucket.series ? { series: bucket.series } : {}), count: bucket.count, value };
      });
      summarized.sort((left, right) => left.key.localeCompare(right.key) || JSON.stringify(left.series ?? {}).localeCompare(JSON.stringify(right.series ?? {})));
      const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : undefined;
      return json({ buckets: limit ? summarized.slice(0, limit) : summarized, totalRows: matched, revision: `r${revision}` });
    }
    if (request.method === "GET" && url.pathname === "/api/presentation") {
      const key = url.searchParams.get("key") ?? "";
      const row = loadPresentation.get(key) as { state: string } | null;
      return row ? json(JSON.parse(row.state)) : json({ error: "No saved presentation" }, 404);
    }
    if (request.method === "PUT" && url.pathname === "/api/presentation") {
      const body = await request.json() as { key: string; state: unknown };
      savePresentation.run(body.key, JSON.stringify(body.state));
      return json({ saved: true });
    }
    return json({ name: "Sheetbase million-row example API", engine: SQL_MODE ? "sql" : "memory", rows: DATASET_ROWS + created.length, revision: `r${revision}` });
  },
});

console.log(`Sheetbase example API listening on http://127.0.0.1:${server.port}/api/table (engine=${SQL_MODE ? `sql:${SQL_ROWS}` : "memory"})`);
