import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** DuckDB's name for this platform, as used for extension builds. */
export function duckdbPlatform(platform: string = process.platform, arch: string = process.arch): string {
  const cpu = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'amd64' : arch
  if (platform === 'darwin') return `osx_${cpu}`
  if (platform === 'win32') return `windows_${cpu}`
  return `${platform}_${cpu}`
}

/** Per-user cache directory, following each OS's convention. */
export function cacheRoot(): string {
  if (process.env.SHEETBASE_CACHE_DIR) return process.env.SHEETBASE_CACHE_DIR
  const home = homedir()
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(home || tmpdir(), 'AppData', 'Local'), 'sheetbase-studio', 'Cache')
  if (process.platform === 'darwin') return join(home || tmpdir(), 'Library', 'Caches', 'sheetbase-studio')
  return join(process.env.XDG_CACHE_HOME || join(home || tmpdir(), '.cache'), 'sheetbase-studio')
}
