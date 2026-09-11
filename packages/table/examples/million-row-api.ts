import { Database } from "bun:sqlite";
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
      const sort = JSON.parse(url.searchParams.get("sort") ?? "[]") as { fieldId: string; direction: "asc" | "desc" }[];
      const candidateCount = TOTAL_ROWS + created.length;
      let totalRows = candidateCount;
      let records: RecordRow[];
      if (!filters.length && !sort.length) {
        records = Array.from({ length: Math.min(rowCount, Math.max(0, candidateCount - rowStart)) }, (_, offset) => {
          const index = rowStart + offset;
          return index < TOTAL_ROWS ? generated(index) : created[index - TOTAL_ROWS];
        });
      } else {
        const candidates: RecordRow[] = [];
        for (let index = 0; index < candidateCount; index++) {
          const row = index < TOTAL_ROWS ? generated(index) : created[index - TOTAL_ROWS];
          if ((filterLogic === "or" ? filters.some((filter) => matches(row.values[filter.fieldId] ?? null, filter)) : filters.every((filter) => matches(row.values[filter.fieldId] ?? null, filter)))) candidates.push(row);
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
      return json({ request: { datasetId: "experiments", rowStart, rowCount, fieldIds, queryKey: url.searchParams.get("queryKey") ?? "", sort, filters, filterLogic }, totalRows, revision: `r${revision}`, records: projected });
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
