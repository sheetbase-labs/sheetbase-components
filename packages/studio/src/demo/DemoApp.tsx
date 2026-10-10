import { useEffect, useMemo, useState } from 'react'
import type { StudioDataSource } from '@sheetbase-labs/sheetbase-shared'
import { createHttpSource } from '../sources/http'
import { MemorySource } from '../sources/memory'
import { SheetbaseStudio } from '../ui/Studio'
import { localDuckDbBundles } from './duckdb-bundles'
import { bioreactorSamples, elisaWells } from './sample-data'

const params = new URLSearchParams(window.location.search)
/** `?server=http://127.0.0.1:8765` adds a studio server (e.g. `sheetbase serve`). */
const SERVER = params.get('server')
/** `?remote=1` keeps even small tables at the source, to exercise the remote path. */
const REMOTE = params.get('remote') === '1'

export function DemoApp() {
  const local = useMemo(() => new MemorySource({
    id: 'demo',
    label: 'Demo data',
    wasm: { bundles: localDuckDbBundles },
    tables: [
      { id: 'bioreactor_samples', label: 'Bioreactor samples', rows: bioreactorSamples() },
      { id: 'elisa_wells', label: 'ELISA plate wells', rows: elisaWells() },
    ],
  }), [])
  const [server, setServer] = useState<StudioDataSource | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  useEffect(() => {
    if (!SERVER) return
    createHttpSource({ baseUrl: SERVER, label: SERVER }).then(setServer, (error: unknown) => setServerError(error instanceof Error ? error.message : String(error)))
  }, [])
  const sources = useMemo(() => (server ? [server, local] : [local]), [server, local])
  return (
    <div className="sbs-demo">
      {serverError && <div className="sbs-demo-banner" role="alert">Couldn’t reach {SERVER}: {serverError}</div>}
      <SheetbaseStudio sources={sources} wasm={{ bundles: localDuckDbBundles }} materialiseLimit={REMOTE ? 0 : undefined} persistKey={REMOTE ? 'sheetbase-studio-demo-remote' : 'sheetbase-studio-demo'} />
    </div>
  )
}
