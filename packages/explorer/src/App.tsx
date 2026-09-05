import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type DataTableHandle } from "./components/DataTable";
import { FieldSelect } from "./components/FieldSelect";
import {
  DATASETS,
  DATASET_BY_ID,
  type DatasetId,
} from "./data/adapters";
import {
  explore,
  type AxisKind,
  type ExploreSpec,
  type FilterCondition,
} from "./lib/explore";
import { ChartRenderer, type ChartKind } from "./lib/chart";
import {
  loadPersistedState,
  persistState,
  type PersistedExploreState,
} from "./lib/persistence";
import { SchemaEditor } from "@sheetbase/schema-editor";
import { RulesEngine } from "@sheetbase/rules-engine";
import { AdvancedSearch } from "@sheetbase/advanced-search";
import {
  compileToDatasetQuery,
  type SearchGroup,
} from "@sheetbase/advanced-search/engine";
import type { FieldDescriptor } from "@sheetbase/shared";

const persisted = loadPersistedState();
const initialDatasetId: DatasetId =
  persisted && DATASET_BY_ID.has(persisted.datasetId)
    ? persisted.datasetId
    : DATASETS[0].id;

function defaultSpec(datasetId: DatasetId): ExploreSpec {
  const ds = DATASET_BY_ID.get(datasetId)!;
  const x = ds.fields.find((f) => f.kind === "categorical")?.id ?? ds.fields[0].id;
  const y = ds.fields.find((f) => f.kind === "numeric")?.id ?? ds.fields[0].id;
  return {
    datasetId,
    xField: x,
    yField: y,
    seriesField: null,
    aggregation: "count",
    filters: [],
  };
}

function restoredSpec(saved: PersistedExploreState | null, datasetId: DatasetId): ExploreSpec {
  const base = defaultSpec(datasetId);
  if (!saved || saved.datasetId !== datasetId) return base;
  const ds = DATASET_BY_ID.get(datasetId)!;
  const ids = new Set(ds.fields.map((f) => f.id));
  return {
    ...base,
    xField: ids.has(saved.xField) ? saved.xField : base.xField,
    yField: ids.has(saved.yField) ? saved.yField : base.yField,
    seriesField:
      saved.seriesField && ids.has(saved.seriesField) ? saved.seriesField : null,
    aggregation: saved.aggregation,
    filters: saved.filters.filter((f) => ids.has(f.field)),
  };
}

function restoredChartKind(
  saved: PersistedExploreState | null,
  spec: ExploreSpec,
): ChartKind {
  const ds = DATASET_BY_ID.get(spec.datasetId)!;
  const xKind = ds.fields.find((f) => f.id === spec.xField)?.kind;
  const allowed: ChartKind[] =
    spec.seriesField != null || xKind === "categorical"
      ? ["bar", "line", "area"]
      : ["bar", "line", "area", "scatter"];
  if (saved && allowed.includes(saved.chartKind)) return saved.chartKind;
  return allowed[0];
}

function App() {
  const [datasetId, setDatasetId] = useState<DatasetId>(initialDatasetId);
  const [spec, setSpec] = useState<ExploreSpec>(() =>
    restoredSpec(persisted, initialDatasetId),
  );
  const [chartKind, setChartKind] = useState<ChartKind>(() =>
    restoredChartKind(persisted, restoredSpec(persisted, initialDatasetId)),
  );
  const [pane, setPane] = useState<"chart" | "table">("chart");
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<SearchGroup | null>(null);
  const tableRef = useRef<DataTableHandle>(null);
  const dataset = DATASET_BY_ID.get(datasetId)!;

  useEffect(() => {
    persistState({
      datasetId,
      xField: spec.xField,
      yField: spec.yField,
      seriesField: spec.seriesField,
      aggregation: spec.aggregation,
      filters: spec.filters,
      chartKind,
    });
  }, [datasetId, spec, chartKind]);

  const result = useMemo(
    () => explore(dataset, spec, searchQuery),
    [dataset, spec, searchQuery],
  );

  const xField = dataset.fields.find((f) => f.id === spec.xField)!;
  const yField = dataset.fields.find((f) => f.id === spec.yField)!;
  const xKind: AxisKind = xField.kind;

  const compiledSearch = useMemo(
    () => (searchQuery ? compileToDatasetQuery(searchQuery) : null),
    [searchQuery],
  );

  const searchFields: FieldDescriptor[] = useMemo(
    () =>
      dataset.fields.map((f) => ({
        id: f.id,
        name: f.label,
        type: f.kind === "numeric" ? "number" : f.kind === "temporal" ? "date" : "text",
      })),
    [dataset],
  );

  const changeDataset = useCallback((id: DatasetId) => {
    setDatasetId(id);
    const next = defaultSpec(id);
    setSpec(next);
    setChartKind("bar");
    setSearchQuery(null);
  }, []);

  const addFilter = () => {
    const field = dataset.fields[0];
    setSpec((s) => ({
      ...s,
      filters: [
        ...s.filters,
        { field: field.id, op: field.kind === "numeric" ? "gte" : "eq", value: "" },
      ],
    }));
  };

  const updateFilter = (i: number, patch: Partial<FilterCondition>) => {
    setSpec((s) => ({
      ...s,
      filters: s.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    }));
  };

  const removeFilter = (i: number) => {
    setSpec((s) => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }));
  };

  const seriesAllowed = xKind === "categorical";
  const scatterAllowed = xKind !== "categorical" && spec.seriesField == null;
  const allowedCharts: ChartKind[] = scatterAllowed
    ? ["bar", "line", "area", "scatter"]
    : ["bar", "line", "area"];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <div>
            <div className="brand-title">Explorer</div>
            <div className="brand-sub">Visual analysis over typed datasets</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost" onClick={() => setSchemaOpen(true)}>
            Schema
          </button>
          <button type="button" className="ghost" onClick={() => setRulesOpen(true)}>
            Rules
          </button>
          <button type="button" className="ghost" onClick={() => setSearchOpen(true)}>
            Search
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <label className="field">
          <span>Dataset</span>
          <select
            value={datasetId}
            onChange={(e) => changeDataset(e.target.value as DatasetId)}
          >
            {DATASETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>X axis</span>
          <FieldSelect
            fields={dataset.fields}
            value={spec.xField}
            onChange={(id) =>
              setSpec((s) => ({
                ...s,
                xField: id,
                seriesField: null,
              }))
            }
          />
        </label>

        <label className="field">
          <span>Y axis</span>
          <FieldSelect
            fields={dataset.fields}
            value={spec.yField}
            onChange={(id) => setSpec((s) => ({ ...s, yField: id }))}
            kinds={["numeric"]}
          />
        </label>

        <label className="field">
          <span>Series (optional)</span>
          <select
            value={spec.seriesField ?? ""}
            disabled={!seriesAllowed}
            onChange={(e) =>
              setSpec((s) => ({
                ...s,
                seriesField: e.target.value || null,
              }))
            }
          >
            <option value="">None</option>
            {dataset.fields
              .filter((f) => f.kind === "categorical" && f.id !== spec.xField)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
          </select>
        </label>

        <label className="field">
          <span>Aggregation</span>
          <select
            value={spec.aggregation}
            onChange={(e) =>
              setSpec((s) => ({
                ...s,
                aggregation: e.target.value as ExploreSpec["aggregation"],
              }))
            }
          >
            <option value="count">Count</option>
            <option value="sum">Sum</option>
            <option value="avg">Average</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
          </select>
        </label>

        <div className="field">
          <span>Chart</span>
          <div className="chip-row">
            {allowedCharts.map((k) => (
              <button
                key={k}
                type="button"
                className={chartKind === k ? "chip on" : "chip"}
                onClick={() => setChartKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className="filters">
          <div className="filters-head">
            <span>Filters</span>
            <button type="button" className="ghost sm" onClick={addFilter}>
              Add
            </button>
          </div>
          {spec.filters.map((f, i) => {
            const field = dataset.fields.find((x) => x.id === f.field);
            return (
              <div className="filter-row" key={i}>
                <select
                  value={f.field}
                  onChange={(e) => updateFilter(i, { field: e.target.value })}
                >
                  {dataset.fields.map((ff) => (
                    <option key={ff.id} value={ff.id}>
                      {ff.label}
                    </option>
                  ))}
                </select>
                <select
                  value={f.op}
                  onChange={(e) =>
                    updateFilter(i, { op: e.target.value as FilterCondition["op"] })
                  }
                >
                  <option value="eq">=</option>
                  <option value="neq">≠</option>
                  {field?.kind === "numeric" || field?.kind === "temporal" ? (
                    <>
                      <option value="gt">&gt;</option>
                      <option value="gte">≥</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">≤</option>
                    </>
                  ) : (
                    <option value="contains">contains</option>
                  )}
                </select>
                <input
                  value={String(f.value)}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                />
                <button type="button" className="ghost sm" onClick={() => removeFilter(i)}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <main className="main">
        <div className="pane-toggle">
          <button
            type="button"
            className={pane === "chart" ? "chip on" : "chip"}
            onClick={() => setPane("chart")}
          >
            Chart
          </button>
          <button
            type="button"
            className={pane === "table" ? "chip on" : "chip"}
            onClick={() => setPane("table")}
          >
            Table
          </button>
          {compiledSearch ? (
            <span className="search-badge">search active</span>
          ) : null}
        </div>
        {pane === "chart" ? (
          <div className="chart-wrap">
            <ChartRenderer
              kind={chartKind}
              result={result}
              xLabel={xField.label}
              yLabel={`${spec.aggregation}(${yField.label})`}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <DataTable
              ref={tableRef}
              rows={dataset.rows}
              fields={dataset.fields}
              query={compiledSearch}
            />
          </div>
        )}
      </main>

      {schemaOpen ? (
        <div className="overlay" role="dialog">
          <div className="overlay-panel wide">
            <div className="overlay-head">
              <strong>Schema editor</strong>
              <button type="button" className="ghost" onClick={() => setSchemaOpen(false)}>
                Close
              </button>
            </div>
            <SchemaEditor />
          </div>
        </div>
      ) : null}

      {rulesOpen ? (
        <div className="overlay" role="dialog">
          <div className="overlay-panel wide">
            <div className="overlay-head">
              <strong>Rules engine</strong>
              <button type="button" className="ghost" onClick={() => setRulesOpen(false)}>
                Close
              </button>
            </div>
            <RulesEngine />
          </div>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="overlay" role="dialog">
          <div className="overlay-panel wide">
            <div className="overlay-head">
              <strong>Advanced search</strong>
              <button type="button" className="ghost" onClick={() => setSearchOpen(false)}>
                Close
              </button>
            </div>
            <AdvancedSearch
              fields={searchFields}
              value={searchQuery ?? undefined}
              onChange={setSearchQuery}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
