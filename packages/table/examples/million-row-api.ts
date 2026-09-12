import { Database } from "bun:sqlite";
// Filter trees are evaluated with the shared predicate so example semantics
// can't drift from the contract. Requires `bun run build:lib` in packages/shared
// first (the workspace import resolves to dist-lib).
import { buildPredicate, type FilterNode } from "sheetbase-shared";
type Scalar = string | number | boolean | null;
type RecordRow = { recordId: string; values: Record<string, Scalar> };
type Write = { datasetId: string; recordId: string; fieldId: string; before?: string; after?: string };

const TOTAL_ROWS = 1_000_000;
const PORT = Number(process.env.SHEETBASE_API_PORT ?? 8787);
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
      const filters = JSON.parse(url.searchParams.get("filters") ?? "[]") as { fieldId: string; operator: string; value?: unknown }[];
      const filterLogic = url.searchParams.get("filterLogic") === "or" ? "or" : "and";
      const filterTreeParam = url.searchParams.get("filterTree");
      // A filter tree is authoritative over the flat clauses when present.
      const treePredicate = filterTreeParam ? buildPredicate(JSON.parse(filterTreeParam) as FilterNode) : null;
      const sort = JSON.parse(url.searchParams.get("sort") ?? "[]") as { fieldId: string; direction: "asc" | "desc" }[];
      const candidateCount = TOTAL_ROWS + created.length;
      let totalRows = candidateCount;
      let records: RecordRow[];
      if (!treePredicate && !filters.length && !sort.length) {
        records = Array.from({ length: Math.min(rowCount, Math.max(0, candidateCount - rowStart)) }, (_, offset) => {
          const index = rowStart + offset;
          return index < TOTAL_ROWS ? generated(index) : created[index - TOTAL_ROWS];
        });
      } else {
        const candidates: RecordRow[] = [];
        for (let index = 0; index < candidateCount; index++) {
          const row = index < TOTAL_ROWS ? generated(index) : created[index - TOTAL_ROWS];
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
        totalRows = candidates.length;
        records = candidates.slice(rowStart, rowStart + rowCount);
      }
      const projected = records.map((row) => ({ recordId: row.recordId, values: Object.fromEntries(fieldIds.map((fieldId) => [fieldId, row.values[fieldId] ?? null])) }));
      return json({ request: { datasetId: "experiments", rowStart, rowCount, fieldIds, queryKey: url.searchParams.get("queryKey") ?? "", sort, filters, filterLogic, ...(filterTreeParam ? { filterTree: JSON.parse(filterTreeParam) } : {}) }, totalRows, revision: `r${revision}`, records: projected });
    }
    if (request.method === "POST" && url.pathname === "/api/table/commits") {
      const body = await request.json() as { writes: Write[]; baseRevision?: string };
      if (body.baseRevision && body.baseRevision !== `r${revision}`) return conflict(body.writes);
      for (const write of body.writes) overrides.set(write.recordId, { ...overrides.get(write.recordId), [write.fieldId]: write.after ?? null });
      revision++;
      return json({ revision: `r${revision}`, accepted: body.writes, rejected: [] });
    }
    if (request.method === "POST" && url.pathname === "/api/table/records") {
      const body = await request.json() as { datasetId: string; values: Record<string, Scalar>; baseRevision?: string };
      if (body.baseRevision && body.baseRevision !== `r${revision}`) return conflict([]);
      const recordId = `created-${created.length + 1}`;
      created.push({ recordId, values: body.values });
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
      const seriesBy = Array.isArray(body.seriesBy) ? body.seriesBy.filter((field): field is string => typeof field === "string" && field !== body.groupBy) : [];
      const predicate = body.filter ? buildPredicate(body.filter) : () => true;
      const buckets = new Map<string, { key: string; series?: Record<string, string>; count: number; values: number[] }>();
      let matched = 0;
      const candidateCount = TOTAL_ROWS + created.length;
      for (let index = 0; index < candidateCount; index++) {
        const row = index < TOTAL_ROWS ? generated(index) : created[index - TOTAL_ROWS];
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
    return json({ name: "Sheetbase million-row example API", rows: TOTAL_ROWS + created.length, revision: `r${revision}` });
  },
});

console.log(`Sheetbase example API listening on http://127.0.0.1:${server.port}/api/table`);
