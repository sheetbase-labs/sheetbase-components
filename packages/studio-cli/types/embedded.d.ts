// Provided by scripts/build-binary.ts when compiling the single binary; absent
// when running from source (the runtime then reads the repository instead).
declare module 'sheetbase:embedded' {
  export const version: string
  export const duckdb: string
  export const platform: string
  export const buildId: string
  export const ui: Record<string, string>
  export const extensions: Record<string, string>
}
