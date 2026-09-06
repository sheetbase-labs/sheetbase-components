import type { FieldWrite } from "./Spreadsheet";

/**
 * Field writes held under a field-write policy ('hold'): applied locally and
 * visible, but not yet sent to the authoritative source. The host reads them
 * (handle `heldFieldWrites()`), persists them its own way, and clears the
 * registry via `commitHeldFieldWrites()` / `discardHeldFieldWrites()`.
 */
export interface HeldFieldWrite {
  write: FieldWrite
  before?: string
}

export type HeldFieldWriteRegistry = ReadonlyMap<string, HeldFieldWrite>

/** Replace-by-address: a re-edit of a held cell updates its held write. */
export function holdFieldWrite(
  held: HeldFieldWriteRegistry,
  write: FieldWrite,
  before?: string,
): Map<string, HeldFieldWrite> {
  return new Map(held).set(write.address, { write, before })
}

export function clearHeldFieldWrites(): Map<string, HeldFieldWrite> {
  return new Map()
}
