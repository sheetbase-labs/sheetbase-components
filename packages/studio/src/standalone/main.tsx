import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@sheetbase-labs/sheetbase-shared/theme.css'
import '@sheetbase-labs/sheetbase-shared/shell.css'
import '../ui/studio.css'
import './standalone.css'
import { createHttpSource, type HttpSource } from '../sources/http'
import { SheetbaseStudio } from '../ui/Studio'

/** The page `sheetbase serve` hosts: one HTTP source on the same origin. */
function StandaloneApp() {
  const [source, setSource] = useState<HttpSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    createHttpSource({ baseUrl: '', label: 'Python', headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then(setSource, (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [])
  if (error) return <div className="sbs-standalone-error" role="alert">Couldn’t reach the Studio server: {error}</div>
  if (!source) return <div className="sbs-standalone-error">Connecting…</div>
  return <SheetbaseStudio sources={source} persistKey="sheetbase-studio-python" />
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('missing #root element')
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <StandaloneApp />
  </React.StrictMode>,
)
