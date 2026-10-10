import { timingSafeEqual } from 'node:crypto'
import type { FilterClause, GroupNode, PageQuery, SortClause, StudioDataSource, TableInfo } from '@sheetbase-labs/sheetbase-shared'
import type { CatalogResponse, FileLike } from '@sheetbase-labs/sheetbase-studio/node'

/** A source the handler can serve; `upload` is optional. */
export type ServedSource = StudioDataSource & { upload?: (file: FileLike, signal?: AbortSignal) => Promise<readonly TableInfo[]> }

/** Static files for the UI: request path (no leading slash) → content. */
export interface UiAssets {
  get(path: string): Promise<{ body: BodyInit; type: string } | null>
}

export interface HandlerOptions {
  source: ServedSource
  /** Accept uploads from the browser. */
  upload: boolean
  /** Require `Authorization: Bearer <token>` (or `?token=`) on API calls. */
  token?: string
  /** The Studio UI. Without it, `/` explains how to build one. */
  ui?: UiAssets
  /** Send permissive CORS headers (UI served from elsewhere). */
  cors?: boolean
  /**
   * Host names the server answers to. Bound to loopback, this defaults to
   * localhost names only, so a web page can't reach it through DNS rebinding.
   */
  allowedHosts?: readonly string[]
  maxUploadBytes?: number
}

/** Rows per page, at most — the same cap as the Python server. */
export const PAGE_MAX = 5000
export const DEFAULT_MAX_UPLOAD = 2 * 1024 ** 3

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function json(status: number, payload: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload, (_key, value) => (typeof value === 'bigint' ? Number(value) : value)), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })
}

function parseJsonParam<T>(raw: string | null, name: string): T | undefined {
  if (raw === null || raw === '') return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new HttpError(400, `${name} must be JSON.`)
  }
}

function intParam(raw: string | null, name: string, fallback: number): number {
  if (raw === null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw new HttpError(400, `${name} must be a non-negative integer.`)
  return value
}

/** Parse the paging route's query string into a `PageQuery`. */
export function pageQueryFrom(params: URLSearchParams): { tableId: string; query: PageQuery } {
  const tableId = params.get('datasetId') ?? ''
  if (!tableId) throw new HttpError(400, 'datasetId is required.')
  const fieldIds = (params.get('fieldIds') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
  const filterLogic = params.get('filterLogic')
  return {
    tableId,
    query: {
      rowStart: intParam(params.get('rowStart'), 'rowStart', 0),
      rowCount: Math.min(PAGE_MAX, intParam(params.get('rowCount'), 'rowCount', 200)),
      fieldIds,
      sort: parseJsonParam<SortClause[]>(params.get('sort'), 'sort'),
      filters: parseJsonParam<FilterClause[]>(params.get('filters'), 'filters'),
      filterLogic: filterLogic === 'or' ? 'or' : filterLogic === 'and' ? 'and' : undefined,
      filterTree: parseJsonParam<GroupNode>(params.get('filterTree'), 'filterTree'),
    },
  }
}

function sameSecret(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1']

const UNBUILT = `<!doctype html><meta charset="utf-8"><title>Sheetbase Studio</title>
<body style="font: 14px system-ui; padding: 40px; max-width: 640px">
<h1 style="font-size: 18px">The Studio UI isn't in this build</h1>
<p>The API is running. Build the UI with <code>bun run --filter sheetbase-studio-cli build:ui</code>, or use a released binary.</p>
</body>`

/** Serve a `StudioDataSource` over the Studio wire contract, plus the UI. */
export function createStudioHandler(options: HandlerOptions): (request: Request) => Promise<Response> {
  const { source } = options
  const maxUpload = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD
  const canUpload = options.upload && typeof source.upload === 'function'
  const corsHeaders: Record<string, string> = options.cors
    ? { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
    : {}

  const api = async (request: Request, url: URL): Promise<Response> => {
    const { pathname } = url
    const signal = request.signal
    const body = async (): Promise<Record<string, unknown>> => {
      try {
        const parsed: unknown = await request.json()
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        return parsed as Record<string, unknown>
      } catch {
        throw new HttpError(400, 'Body must be a JSON object.')
      }
    }
    const table = (payload: Record<string, unknown>) => {
      const id = payload.datasetId
      if (typeof id !== 'string' || !id) throw new HttpError(400, 'datasetId is required.')
      const { datasetId: _ignored, ...query } = payload
      return { id, query }
    }

    if (request.method === 'GET' && pathname === '/api/studio/catalog') {
      const catalog: CatalogResponse = {
        source: { id: source.id, label: source.label, kind: source.kind },
        capabilities: { ...source.capabilities, upload: canUpload },
        tables: [...(await source.catalog(signal))],
      }
      return json(200, catalog)
    }
    if (request.method === 'GET' && pathname === '/api/table/pages') {
      const { tableId, query } = pageQueryFrom(url.searchParams)
      const page = await source.page(tableId, query, signal)
      return json(200, { ...page, request: { datasetId: tableId, rowStart: query.rowStart, rowCount: query.rowCount, fieldIds: query.fieldIds } })
    }
    if (request.method !== 'POST') throw new HttpError(404, `No route for ${request.method} ${pathname}`)
    switch (pathname) {
      case '/api/explorer/aggregate': {
        const { id, query } = table(await body())
        return json(200, await source.aggregate(id, query as never, signal))
      }
      case '/api/studio/profile': {
        if (!source.profile) throw new HttpError(404, 'Profiling is not available.')
        const { id, query } = table(await body())
        return json(200, await source.profile(id, query as never, signal))
      }
      case '/api/studio/histogram': {
        if (!source.histogram) throw new HttpError(404, 'Histograms are not available.')
        const { id, query } = table(await body())
        return json(200, await source.histogram(id, query as never, signal))
      }
      case '/api/studio/sample': {
        if (!source.sample) throw new HttpError(404, 'Sampling is not available.')
        const { id, query } = table(await body())
        return json(200, await source.sample(id, query as never, signal))
      }
      case '/api/studio/sql': {
        if (!source.sql || !source.capabilities.sql) throw new HttpError(403, 'SQL is turned off on this server.')
        const payload = await body()
        if (typeof payload.sql !== 'string') throw new HttpError(400, 'sql is required.')
        return json(200, await source.sql(payload.sql, signal))
      }
      case '/api/studio/upload': {
        if (!canUpload || !source.upload) throw new HttpError(403, 'Uploads are turned off on this server.')
        const length = Number(request.headers.get('content-length') ?? '0')
        if (length > maxUpload) throw new HttpError(413, 'File too large.')
        let file: FormDataEntryValue | null
        try {
          file = (await request.formData()).get('file')
        } catch {
          throw new HttpError(400, "Send the file as multipart form data under 'file'.")
        }
        if (!file || typeof file === 'string') throw new HttpError(400, "Send the file as multipart form data under 'file'.")
        return json(200, { tables: await source.upload(file, signal) })
      }
      default:
        throw new HttpError(404, `No route for POST ${pathname}`)
    }
  }

  const authorised = (request: Request, url: URL) => {
    if (!options.token) return true
    const header = request.headers.get('authorization') ?? ''
    const supplied = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : url.searchParams.get('token') ?? ''
    return sameSecret(supplied, options.token)
  }

  // Bun builds `request.url` from the Host header, so its hostname is the
  // name the browser used — the thing DNS rebinding changes.
  const hostAllowed = (url: URL) => !options.allowedHosts || options.allowedHosts.includes(url.hostname.toLowerCase())

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (!hostAllowed(url)) return new Response('Unknown host', { status: 421 })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (url.pathname.startsWith('/api/')) {
      if (!authorised(request, url)) return json(401, { error: 'Missing or wrong token.' }, corsHeaders)
      try {
        const response = await api(request, url)
        for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value)
        return response
      } catch (error) {
        if (error instanceof HttpError) return json(error.status, { error: error.message }, corsHeaders)
        if (error instanceof Error && error.name === 'AbortError') return json(499, { error: 'Cancelled.' }, corsHeaders)
        const message = error instanceof Error ? error.message : String(error)
        const status = /^Unknown table/.test(message) ? 404 : 400
        return json(status, { error: message }, corsHeaders)
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    if (!options.ui) return new Response(UNBUILT, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    // Single-page app: unknown paths get the shell.
    const asset = (path && !path.includes('..') ? await options.ui.get(path) : null) ?? await options.ui.get('index.html')
    if (!asset) return new Response(UNBUILT, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    const immutable = /^assets\//.test(path)
    return new Response(asset.body, {
      headers: {
        'content-type': asset.type,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    })
  }
}

export { LOCAL_HOSTS }
