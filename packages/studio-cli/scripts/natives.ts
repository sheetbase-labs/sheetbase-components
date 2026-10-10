/**
 * Native pieces the binary carries, fetched from their official packages and
 * verified against the registries' published digests:
 *
 * - DuckDB's Node binding (`@duckdb/node-bindings-<platform>` on npm): the
 *   addon plus the DuckDB shared library it loads from its own directory.
 * - DuckDB connector extensions (`duckdb-extension-*` on PyPI, the official
 *   builds repackaged per platform), so nothing is downloaded at runtime.
 *
 * Output: `.cache/natives/<duckdb>/<platform>/` with `binding/` and
 * `extensions/`. Re-runs reuse what's already there.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
export const cliRoot = join(here, '..')
const repoRoot = join(cliRoot, '..', '..')

/** The connectors the binary ships. */
export const EXTENSIONS = ['sqlite_scanner', 'postgres_scanner', 'mysql_scanner'] as const

export interface Target {
  /** DuckDB's platform name (extension builds). */
  duckdb: string
  /** npm package suffix for the Node binding. */
  npm: string
  /** PyPI wheel platform tag. */
  wheel: string
  /** Bun compile target. */
  bun: string
  /** DuckDB shared library file name inside the binding package. */
  library: string
}

export const TARGETS: Record<string, Target> = {
  linux_amd64: { duckdb: 'linux_amd64', npm: 'linux-x64', wheel: 'manylinux2014_x86_64', bun: 'bun-linux-x64', library: 'libduckdb.so' },
  linux_arm64: { duckdb: 'linux_arm64', npm: 'linux-arm64', wheel: 'manylinux2014_aarch64', bun: 'bun-linux-arm64', library: 'libduckdb.so' },
  osx_arm64: { duckdb: 'osx_arm64', npm: 'darwin-arm64', wheel: 'macosx_11_0_arm64', bun: 'bun-darwin-arm64', library: 'libduckdb.dylib' },
  osx_amd64: { duckdb: 'osx_amd64', npm: 'darwin-x64', wheel: 'macosx_11_0_x86_64', bun: 'bun-darwin-x64', library: 'libduckdb.dylib' },
  windows_amd64: { duckdb: 'windows_amd64', npm: 'win32-x64', wheel: 'win_amd64', bun: 'bun-windows-x64', library: 'duckdb.dll' },
}

/** The DuckDB binding version the CLI depends on, e.g. "1.5.5-r.5". */
export function bindingVersion(): string {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'node_modules', '@duckdb', 'node-api', 'package.json'), 'utf8')) as { version: string }
  return manifest.version
}

/** "1.5.5-r.5" → "1.5.5": the DuckDB release extensions must match exactly. */
export function duckdbVersion(binding = bindingVersion()): string {
  return binding.replace(/-.*$/, '')
}

export function nativesDir(target: Target, version = duckdbVersion()): string {
  return join(cliRoot, '.cache', 'natives', `v${version}`, target.duckdb)
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`)
  return (await response.json()) as T
}

/** Minimal ZIP reader (wheels): central directory → stored/deflated entries. */
function unzip(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let end = data.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('Not a zip file')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const files = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Bad zip central directory')
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength))
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = data.subarray(start, start + compressed)
    files.set(name, method === 0 ? raw : method === 8 ? new Uint8Array(inflateRawSync(raw)) : (() => { throw new Error(`Unsupported zip method ${method}`) })())
    offset += 46 + nameLength + extraLength + commentLength
  }
  return files
}

/** Minimal tar reader (npm tarballs, already gunzipped). */
function untar(data: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const field = (start: number, length: number) => new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0.*$/s, '')
    const name = (field(345, 155) ? `${field(345, 155)}/` : '') + field(0, 100)
    const size = Number.parseInt(field(124, 12).trim() || '0', 8)
    const type = field(156, 1)
    if (type === '0' || type === '') files.set(name, data.slice(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Fetch (or reuse) the binding and extensions for one target. Returns its directory. */
export async function fetchNatives(target: Target, log: (line: string) => void = console.log): Promise<string> {
  const binding = bindingVersion()
  const version = duckdbVersion(binding)
  const dir = nativesDir(target, version)
  const bindingDir = join(dir, 'binding')
  const extensionDir = join(dir, 'extensions')
  mkdirSync(bindingDir, { recursive: true })
  mkdirSync(extensionDir, { recursive: true })

  if (!existsSync(join(bindingDir, 'duckdb.node')) || !existsSync(join(bindingDir, target.library))) {
    const name = `@duckdb/node-bindings-${target.npm}`
    const meta = await json<{ dist: { tarball: string; integrity: string } }>(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${binding}`)
    const tarball = await download(meta.dist.tarball)
    const [algorithm, expected] = meta.dist.integrity.split('-', 2) as [string, string]
    const actual = createHash(algorithm).update(tarball).digest('base64')
    if (actual !== expected) throw new Error(`${name}@${binding}: integrity mismatch`)
    const files = untar(new Uint8Array(gunzipSync(tarball)))
    for (const file of ['duckdb.node', target.library]) {
      const content = files.get(`package/${file}`)
      if (!content) throw new Error(`${name}@${binding} has no ${file}`)
      writeFileSync(join(bindingDir, file), content)
    }
    log(`  binding   ${name}@${binding} (verified)`)
  }

  for (const extension of EXTENSIONS) {
    const out = join(extensionDir, `${extension}.duckdb_extension`)
    if (existsSync(out)) continue
    const project = `duckdb-extension-${extension.replace(/_/g, '-')}`
    const release = await json<{ urls: { filename: string; url: string; digests: { sha256: string } }[] }>(`https://pypi.org/pypi/${project}/${version}/json`)
    const wheel = release.urls.find((file) => file.filename.includes(`-${target.wheel}.`))
    if (!wheel) throw new Error(`${project}==${version} has no ${target.wheel} wheel`)
    const data = await download(wheel.url)
    if (sha256(data) !== wheel.digests.sha256) throw new Error(`${wheel.filename}: sha256 mismatch`)
    const entry = [...unzip(data)].find(([name]) => name.endsWith(`/v${version}/${extension}.duckdb_extension`))
    if (!entry) throw new Error(`${wheel.filename} has no v${version}/${extension}.duckdb_extension`)
    writeFileSync(out, entry[1])
    log(`  extension ${extension} v${version} ${target.duckdb} (verified)`)
  }
  return dir
}

/** The target for the machine running this script. */
export function hostTarget(): Target {
  const cpu = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const key = process.platform === 'darwin' ? `osx_${cpu}` : process.platform === 'win32' ? `windows_${cpu}` : `linux_${cpu}`
  const target = TARGETS[key]
  if (!target) throw new Error(`No build target for ${process.platform}/${process.arch}`)
  return target
}

if (import.meta.main) {
  const names = process.argv.slice(2)
  const targets = names.length ? names.map((name) => TARGETS[name] ?? (() => { throw new Error(`Unknown target ${name}; one of ${Object.keys(TARGETS).join(', ')}`) })()) : [hostTarget()]
  for (const target of targets) {
    console.log(`${target.duckdb}:`)
    console.log(`  → ${await fetchNatives(target)}`)
  }
}
