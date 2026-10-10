import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@sheetbase-labs/sheetbase-shared/theme.css'
import '@sheetbase-labs/sheetbase-shared/shell.css'
import '../ui/studio.css'
import './widget.css'
import type { StudioTransport } from '../sources/http'
import { HttpSource } from '../sources/http'
import { SheetbaseStudio } from '../ui/Studio'

/** The slice of the anywidget model the Studio uses. */
interface WidgetModel {
  get(name: string): unknown
  send(content: unknown, callbacks?: unknown, buffers?: ArrayBuffer[]): void
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
}

type Pending = { resolve(value: unknown): void; reject(error: Error): void }

/** Requests over the widget comm, answered by the kernel's StudioBackend. */
export function commTransport(model: WidgetModel): StudioTransport & { dispose(): void } {
  let next = 0
  const pending = new Map<number, Pending>()
  const onMessage = (...args: unknown[]) => {
    const message = args[0] as { type?: string; id?: number; status?: number; body?: { error?: string } }
    if (message?.type !== 'response' || message.id === undefined) return
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if ((message.status ?? 500) >= 400) waiting.reject(new Error(message.body?.error ?? `Request failed (${message.status})`))
    else waiting.resolve(message.body)
  }
  model.on('msg:custom', onMessage)
  const request = (method: 'GET' | 'POST', path: string, payload: Record<string, unknown>, signal?: AbortSignal, buffers?: ArrayBuffer[]) => new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('The request was aborted.', 'AbortError')); return }
    const id = ++next
    pending.set(id, { resolve, reject })
    signal?.addEventListener('abort', () => {
      if (pending.delete(id)) reject(new DOMException('The request was aborted.', 'AbortError'))
    }, { once: true })
    model.send({ type: 'request', id, method, path, ...payload }, undefined, buffers)
  })
  return {
    get: (path, params, signal) => request('GET', path, { params }, signal),
    post: (path, body, signal) => request('POST', path, { body }, signal),
    upload: async (path, file, signal) => request('POST', path, { filename: file.name }, signal, [await file.arrayBuffer()]),
    dispose: () => model.off('msg:custom', onMessage),
  }
}

function WidgetApp({ model, transport }: { model: WidgetModel; transport: StudioTransport }) {
  const [source, setSource] = useState<HttpSource | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    HttpSource.connect(transport, { id: 'notebook', label: 'Notebook', kind: 'python' }).then(setSource, (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
  }, [transport])
  // The kernel added a table: reconnect so the catalog picks it up.
  useEffect(() => {
    const onMessage = (...args: unknown[]) => {
      const message = args[0] as { type?: string }
      if (message?.type === 'catalog-changed') {
        HttpSource.connect(transport, { id: 'notebook', label: 'Notebook', kind: 'python' }).then((next) => { setSource(next); setEpoch((n) => n + 1) }, () => undefined)
      }
    }
    model.on('msg:custom', onMessage)
    return () => model.off('msg:custom', onMessage)
  }, [model, transport])
  const height = Number(model.get('height')) || 680
  const theme = String(model.get('theme') || 'system') as 'light' | 'dark' | 'system'
  if (error) return <div className="sbs-widget-note" role="alert">Couldn’t reach the kernel: {error}</div>
  if (!source) return <div className="sbs-widget-note">Connecting to the kernel…</div>
  return (
    <div className="sbs-widget" style={{ height }}>
      <SheetbaseStudio key={epoch} sources={source} theme={theme} title={String(model.get('title') || 'Studio')} persistKey="sheetbase-studio-widget" />
    </div>
  )
}

export default {
  render({ model, el }: { model: WidgetModel; el: HTMLElement }) {
    const transport = commTransport(model)
    const root = createRoot(el)
    root.render(<WidgetApp model={model} transport={transport} />)
    return () => {
      root.unmount()
      transport.dispose()
    }
  },
}
