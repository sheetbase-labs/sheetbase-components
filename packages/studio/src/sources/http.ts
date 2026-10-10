import type {
  HistogramQuery,
  HistogramResponse,
  PageQuery,
  PageResponse,
  ProfileQuery,
  ProfileResponse,
  SampleQuery,
  SampleResponse,
  SourceCapabilities,
  StudioDataSource,
  TableInfo,
  WorkspaceAggregateQuery,
  WorkspaceAggregateResponse,
} from '@sheetbase-labs/sheetbase-shared'

/**
 * The studio wire contract. Paging and aggregation reuse the routes the
 * table and explorer already speak; the rest live under `/api/studio`.
 *
 * | Route | Body / params | Response |
 * |---|---|---|
 * | `GET  /api/studio/catalog` | — | `CatalogResponse` |
 * | `GET  /api/table/pages` | `datasetId`, `rowStart`, `rowCount`, `fieldIds`, `sort`, `filters`, `filterLogic`, `filterTree` | `{ records, totalRows, revision? }` |
 * | `POST /api/explorer/aggregate` | `{ datasetId, ...AggregateQuery }` | `AggregateResponse` |
 * | `POST /api/studio/profile` | `{ datasetId, ...ProfileQuery }` | `ProfileResponse` |
 * | `POST /api/studio/histogram` | `{ datasetId, ...HistogramQuery }` | `HistogramResponse` |
 * | `POST /api/studio/sample` | `{ datasetId, ...SampleQuery }` | `SampleResponse` |
 * | `POST /api/studio/sql` | `{ sql }` | `TableInfo` |
 * | `POST /api/studio/upload` | multipart `file` | `{ tables: TableInfo[] }` |
 *
 * Errors are non-2xx with `{ error: string }`.
 */
export interface CatalogResponse {
  source?: { id?: string; label?: string; kind?: string }
  capabilities: SourceCapabilities & { upload?: boolean }
  tables: TableInfo[]
}

/** How requests reach the backend: HTTP by default, a notebook comm in the widget. */
export interface StudioTransport {
  get(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown>
  post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown>
  upload?(path: string, file: File, signal?: AbortSignal): Promise<unknown>
}

export interface FetchTransportOptions {
  /** e.g. "http://127.0.0.1:8765" — routes are appended. Empty for same-origin. */
  baseUrl?: string
  /** Extra headers on every request (auth tokens). */
  headers?: Record<string, string> | (() => Record<string, string>)
  fetcher?: typeof fetch
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `Request failed (${response.status})`
    throw new Error(message)
  }
  return body
}

export function fetchTransport(options: FetchTransportOptions = {}): StudioTransport {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '')
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const headers = () => (typeof options.headers === 'function' ? options.headers() : options.headers ?? {})
  return {
    async get(path, params, signal) {
      const query = new URLSearchParams(params).toString()
      return readJson(await fetcher(`${base}${path}${query ? `?${query}` : ''}`, { headers: headers(), signal: signal ?? null }))
    },
    async post(path, body, signal) {
      return readJson(await fetcher(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers() },
        body: JSON.stringify(body),
        signal: signal ?? null,
      }))
    },
    async upload(path, file, signal) {
      const form = new FormData()
      form.append('file', file, file.name)
      return readJson(await fetcher(`${base}${path}`, { method: 'POST', headers: headers(), body: form, signal: signal ?? null }))
    },
  }
}

/** Source backed by any server speaking the studio wire contract. */
export class HttpSource implements StudioDataSource {
  readonly id: string
  readonly label: string
  readonly kind: string
  capabilities: SourceCapabilities
  readonly transport: StudioTransport
  #tables: TableInfo[] = []
  readonly #canUpload: boolean

  private constructor(transport: StudioTransport, catalog: CatalogResponse, fallback: { id: string; label: string; kind: string }) {
    this.transport = transport
    this.id = catalog.source?.id ?? fallback.id
    this.label = catalog.source?.label ?? fallback.label
    this.kind = catalog.source?.kind ?? fallback.kind
    const { upload, ...capabilities } = catalog.capabilities
    this.capabilities = capabilities
    this.#canUpload = Boolean(upload) && typeof transport.upload === 'function'
    this.#tables = catalog.tables
    if (!this.#canUpload) this.upload = undefined
  }

  /** Connect: reads the catalog once to learn the tables and capabilities. */
  static async connect(transport: StudioTransport, fallback: { id?: string; label?: string; kind?: string } = {}): Promise<HttpSource> {
    const catalog = await transport.get('/api/studio/catalog', {}) as CatalogResponse
    if (!catalog || !Array.isArray(catalog.tables) || !catalog.capabilities) throw new Error('The server did not return a studio catalog.')
    return new HttpSource(transport, catalog, { id: fallback.id ?? 'http', label: fallback.label ?? 'Server', kind: fallback.kind ?? 'http' })
  }

  async catalog(signal?: AbortSignal): Promise<readonly TableInfo[]> {
    const catalog = await this.transport.get('/api/studio/catalog', {}, signal) as CatalogResponse
    this.#tables = catalog.tables
    return this.#tables
  }

  async page(tableId: string, query: PageQuery, signal?: AbortSignal): Promise<PageResponse> {
    const params: Record<string, string> = {
      datasetId: tableId,
      rowStart: String(query.rowStart),
      rowCount: String(query.rowCount),
      fieldIds: query.fieldIds.join(','),
    }
    if (query.sort?.length) params.sort = JSON.stringify(query.sort)
    if (query.filters?.length) params.filters = JSON.stringify(query.filters)
    if (query.filterLogic) params.filterLogic = query.filterLogic
    if (query.filterTree) params.filterTree = JSON.stringify(query.filterTree)
    return await this.transport.get('/api/table/pages', params, signal) as PageResponse
  }

  async aggregate(tableId: string, query: WorkspaceAggregateQuery, signal?: AbortSignal): Promise<WorkspaceAggregateResponse> {
    return await this.transport.post('/api/explorer/aggregate', { datasetId: tableId, ...query }, signal) as WorkspaceAggregateResponse
  }

  async profile(tableId: string, query: ProfileQuery, signal?: AbortSignal): Promise<ProfileResponse> {
    return await this.transport.post('/api/studio/profile', { datasetId: tableId, ...query }, signal) as ProfileResponse
  }

  async histogram(tableId: string, query: HistogramQuery, signal?: AbortSignal): Promise<HistogramResponse> {
    return await this.transport.post('/api/studio/histogram', { datasetId: tableId, ...query }, signal) as HistogramResponse
  }

  async sample(tableId: string, query: SampleQuery, signal?: AbortSignal): Promise<SampleResponse> {
    return await this.transport.post('/api/studio/sample', { datasetId: tableId, ...query }, signal) as SampleResponse
  }

  async sql(text: string, signal?: AbortSignal): Promise<TableInfo> {
    const info = await this.transport.post('/api/studio/sql', { sql: text }, signal) as TableInfo
    this.#tables = [...this.#tables.filter((table) => table.id !== info.id), info]
    return info
  }

  upload?: (file: File, signal?: AbortSignal) => Promise<readonly TableInfo[]> = async (file, signal) => {
    const upload = this.transport.upload
    if (!upload) throw new Error('This server does not accept uploads.')
    const response = await upload.call(this.transport, '/api/studio/upload', file, signal) as { tables: TableInfo[] }
    this.#tables = [...this.#tables, ...response.tables]
    return response.tables
  }
}

/** Convenience: connect to a studio server over HTTP. */
export function createHttpSource(options: FetchTransportOptions & { id?: string; label?: string } = {}): Promise<HttpSource> {
  return HttpSource.connect(fetchTransport(options), { id: options.id, label: options.label ?? options.baseUrl ?? 'Server', kind: 'http' })
}
