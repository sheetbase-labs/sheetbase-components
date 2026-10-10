#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { DEFAULT_MAX_UPLOAD, LOCAL_HOSTS, createStudioHandler } from './handler'
import { loadRuntime } from './runtime'
import { openStudio } from './studio'

const HELP = `Sheetbase Studio — explore files and databases in your browser.

Usage:
  sheetbase-studio [files or folders…] [options]

Data:
  files…                 CSV, TSV, Parquet, JSON or Excel files, or folders of them
  --db <url>             A database to open read-only (repeatable):
                           postgres://user@host:5432/db   mysql://user@host/db
                           path/to/file.sqlite            path/to/file.duckdb
                         Name it with name=<url>, e.g. --db lims=postgres://…
  --table <name>         Only these tables from --db (repeatable):
                           assays, qc.assays or lims.qc.assays

Server:
  --host <host>          Interface to listen on (default 127.0.0.1)
  --port <port>          Port (default 8765; the next free one if taken)
  --token                Require a random access token (always on beyond localhost)
  --no-browser           Don't open a browser
  --no-sql               Hide the SQL editor
  --no-upload            Don't let people open more files from the browser
  --max-upload <MB>      Largest upload accepted (default 2048)
  --cors                 Allow cross-origin requests (UI served elsewhere)

  --version              Print the version
  --help                 Show this help

Everything is read-only: databases are attached read-only and SQL is limited to
a single SELECT/WITH query. Connect with a read-only database role as well.`

function fail(message: string): never {
  console.error(`sheetbase-studio: ${message}`)
  process.exit(2)
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url]
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }).unref()
  } catch {
    // No browser available (a server, CI): the URL is printed anyway.
  }
}

async function main(argv: string[]) {
  // `sheetbase-studio serve …` reads the same as `sheetbase serve …`.
  const args = argv[0] === 'serve' ? argv.slice(1) : argv
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        db: { type: 'string', multiple: true },
        table: { type: 'string', multiple: true },
        host: { type: 'string', default: '127.0.0.1' },
        port: { type: 'string', default: '8765' },
        token: { type: 'boolean', default: false },
        'no-browser': { type: 'boolean', default: false },
        'no-sql': { type: 'boolean', default: false },
        'no-upload': { type: 'boolean', default: false },
        'max-upload': { type: 'string' },
        cors: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\nRun with --help for usage.`)
  }
  const values = parsed.values as Record<string, string | boolean | string[] | undefined>
  const runtime = await loadRuntime()
  if (values.help) {
    console.log(HELP)
    return
  }
  if (values.version) {
    console.log(`sheetbase-studio ${runtime.version} (DuckDB ${runtime.duckdb})`)
    return
  }

  const host = String(values.host)
  const local = LOCAL_HOSTS.includes(host.toLowerCase())
  const port = Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be a port number, not ${values.port}`)
  const maxUploadMb = values['max-upload'] === undefined ? DEFAULT_MAX_UPLOAD / 1024 ** 2 : Number(values['max-upload'])
  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) fail('--max-upload must be a number of megabytes')
  // Beyond localhost a token is required, not just recommended.
  const token = values.token || !local ? randomBytes(18).toString('base64url') : undefined

  const files = parsed.positionals
  const databases = (values.db as string[] | undefined) ?? []
  const tables = (values.table as string[] | undefined) ?? []
  if (tables.length && !databases.length) fail('--table needs a --db to pick tables from')

  console.log(`Sheetbase Studio ${runtime.version}`)
  if (files.length || databases.length) console.log('Opening:')
  let studio: Awaited<ReturnType<typeof openStudio>>
  try {
    studio = await openStudio({
      files,
      databases,
      tables,
      sql: !values['no-sql'],
      upload: !values['no-upload'],
      extensionPath: (name) => runtime.extensionPath(name),
      log: (line) => console.log(line),
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  if (!files.length && !databases.length) console.log('Nothing opened yet: drop files into the browser, or pass files / --db.')

  const handler = createStudioHandler({
    source: studio.source,
    upload: studio.upload,
    token,
    ui: runtime.ui,
    cors: Boolean(values.cors),
    allowedHosts: local ? LOCAL_HOSTS : undefined,
    maxUploadBytes: maxUploadMb * 1024 ** 2,
  })

  let server: ReturnType<typeof Bun.serve> | undefined
  const attempts = values.port === '0' ? 1 : 20
  for (let offset = 0; offset < attempts && !server; offset++) {
    try {
      server = Bun.serve({ hostname: host, port: port === 0 ? 0 : port + offset, fetch: handler, maxRequestBodySize: maxUploadMb * 1024 ** 2 + 1024 * 1024, idleTimeout: 255 })
    } catch (error) {
      if (offset === attempts - 1 || !/EADDRINUSE|in use/i.test(String(error))) fail(`Couldn't listen on ${host}:${port + offset}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!server) fail(`Couldn't find a free port from ${port}`)
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host
  const url = `http://${shown}:${server.port}/${token ? `?token=${token}` : ''}`
  console.log(`\nSheetbase Studio is running at ${url}`)
  if (!local) console.log('Share the link only with people who should see this data; it carries the access token.')
  console.log('Press Ctrl+C to stop.')
  if (!values['no-browser']) openBrowser(url)

  const stop = () => {
    server?.stop(true)
    studio.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

await main(process.argv.slice(2))
