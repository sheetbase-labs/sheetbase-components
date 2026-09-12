import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { createHttpExplorerAdapter } from './lib/adapters/http'
import { sampleAdapter } from './lib/adapters/sample'
import 'sheetbase-shared/theme.css'
import 'sheetbase-shared/shell.css'
import './styles.css'
import './ux-overrides.css'
import './explorer-v2.css'
import './explorer-v3.css'
import './explorer-interactions.css'

// Remote source against the table package's example API (`bun run dev:api`
// in packages/table, listening on :8787). load() returns column metadata
// only — aggregated chart data is fetched per spec.
const experimentsRemote = createHttpExplorerAdapter({
  baseUrl: 'http://127.0.0.1:8787',
  datasetId: 'experiments',
  name: 'Experiments API (remote)',
  fields: [
    { key: 'experiment_id', kind: 'string', uniqueCount: 1_000_000 },
    { key: 'sample_id', kind: 'string', uniqueCount: 1_000_000 },
    { key: 'assay', kind: 'string', uniqueCount: 7 },
    { key: 'result', kind: 'number', uniqueCount: 100_000 },
    { key: 'unit', kind: 'string', uniqueCount: 2 },
    { key: 'run_date', kind: 'date', uniqueCount: 365 },
    { key: 'status', kind: 'string', uniqueCount: 3 },
    { key: 'reviewer', kind: 'string', uniqueCount: 4 },
    { key: 'approved', kind: 'boolean', uniqueCount: 2 },
  ],
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error("missing #root element")
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <div className="sb-demo-stage">
      <App sources={[sampleAdapter, experimentsRemote]} />
    </div>
  </React.StrictMode>,
)
