import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * Write an embedded file to `target` once. Gzipped sources (`.gz`) are
 * inflated. The write goes to a temporary name first and is renamed into
 * place, so two copies starting at once never load a half-written file.
 */
export function unpackOnce(source: string, target: string): string {
  if (existsSync(target)) return target
  mkdirSync(dirname(target), { recursive: true })
  const raw = readFileSync(source)
  const data = source.endsWith('.gz') ? gunzipSync(raw) : raw
  const temporary = join(dirname(target), `.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(temporary, data, { mode: 0o755 })
  try {
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { force: true })
    if (!existsSync(target)) throw error
  }
  return target
}
