/**
 * Per-cell annotations (Phase 2): provenance notes and review comments.
 * Stored as plain arrays in presentation state (JSON-serialisable) and
 * rendered as an overlay indicator by the grid.
 *
 * Two identity namespaces:
 * - Unbound sheets key on the A1 `address` — the note is a sheet-local
 *   coordinate annotation.
 * - Bound grids key on `(recordId, fieldId)` — the note belongs to the
 *   record's field and follows it across sort/filter/page; `address` is
 *   denormalised to wherever the cell sat when last written (stale after
 *   re-sort — never used for bound lookup). Free columns in a bound grid
 *   (a row that maps to a record but a column with no fieldId) stay
 *   address-keyed: a `(recordId, undefined)` half-key has no defined cell
 *   to resolve to, so none is stored.
 *
 * A host storing annotations server-side should key on (recordId, fieldId);
 * that pair is what makes the storage sane.
 */
export interface CellAnnotation {
  /**
   * Sheet coordinate — display/fallback. On bound grids this is
   * denormalised: `recordId`+`fieldId` are the identity.
   */
  address: string
  /** Bound-grid identity — set when the annotated cell mapped to a record. */
  recordId?: string
  fieldId?: string
  text: string
  author?: string
  createdAt?: string
}

/**
 * The cell a lookup applies to. `recordId`/`fieldId` are the bound-grid
 * identity; `bound` distinguishes "bound cell that resolved no record" from
 * "unbound cell" — on a bound grid a record-keyed annotation's stored
 * address is stale and must never match by coordinate.
 */
export type AnnotationCellRef = Readonly<{
  address: string
  recordId?: string
  fieldId?: string
  bound?: boolean
}>

export function normaliseCellAnnotations(value: unknown): CellAnnotation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const candidate = entry as { address?: unknown; text?: unknown; author?: unknown; createdAt?: unknown; recordId?: unknown; fieldId?: unknown }
    if (typeof candidate.address !== "string" || typeof candidate.text !== "string") return []
    if (candidate.text === "") return []
    // The pair is stored only when complete — a half-keyed entry falls back
    // to its address rather than carrying an unresolvable record reference.
    const identity = typeof candidate.recordId === "string" && typeof candidate.fieldId === "string"
      ? { recordId: candidate.recordId, fieldId: candidate.fieldId }
      : {}
    return [{
      address: candidate.address,
      ...identity,
      text: candidate.text,
      ...(typeof candidate.author === "string" ? { author: candidate.author } : {}),
      ...(typeof candidate.createdAt === "string" ? { createdAt: candidate.createdAt } : {}),
    }]
  })
}

/**
 * Immutable set: replaces the annotation on a cell or appends a new one.
 * When `meta.recordId`+`fieldId` are both present the entry is record-keyed;
 * it replaces any existing annotation for that pair wherever it renders.
 * `meta.bound` marks a bound-grid write without resolvable identity (a free
 * column or recordless row): it replaces address-keyed entries at the
 * address but leaves record-keyed entries — whose stored address is stale —
 * untouched.
 */
export function setAnnotation(
  annotations: readonly CellAnnotation[],
  address: string,
  text: string,
  meta?: { author?: string; createdAt?: string; recordId?: string; fieldId?: string; bound?: boolean },
): CellAnnotation[] {
  const trimmed = text.trim()
  const keyed = meta?.recordId !== undefined && meta?.fieldId !== undefined
  const others = annotations.filter((annotation) => {
    if (keyed && annotation.recordId === meta.recordId && annotation.fieldId === meta.fieldId) return false
    if (annotation.address !== address) return true
    // Bound writes only displace address-keyed entries at the coordinate.
    return meta?.bound ? annotation.recordId !== undefined : false
  })
  if (trimmed === "") return others
  return [
    ...others,
    {
      address,
      ...(keyed ? { recordId: meta.recordId, fieldId: meta.fieldId } : {}),
      text: trimmed,
      ...(meta?.author ? { author: meta.author } : {}),
      ...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
    },
  ]
}

/** Remove the annotation resolving to a cell — by (recordId, fieldId) when the ref carries both, else by address (bound refs never match a record-keyed entry's stale address). */
export function removeAnnotation(annotations: readonly CellAnnotation[], cell: string | AnnotationCellRef): CellAnnotation[] {
  const target: AnnotationCellRef = typeof cell === "string" ? { address: cell } : cell
  const keyed = target.recordId !== undefined && target.fieldId !== undefined
  return annotations.filter((annotation) => {
    if (keyed && annotation.recordId === target.recordId && annotation.fieldId === target.fieldId) return false
    if (annotation.address !== target.address) return true
    return target.bound ? annotation.recordId !== undefined : false
  })
}

/**
 * Lookup for render: a bound cell (ref carries recordId+fieldId) prefers its
 * record's annotation, falling back to address-keyed entries only — a
 * record-keyed note pinned at this coordinate by a now-stale address never
 * lands on the wrong record. Unbound cells match on address.
 */
export function annotationForCell(
  annotations: readonly CellAnnotation[],
  cell: AnnotationCellRef,
): CellAnnotation | undefined {
  if (cell.recordId !== undefined && cell.fieldId !== undefined) {
    return annotations.find((annotation) => annotation.recordId === cell.recordId && annotation.fieldId === cell.fieldId)
      ?? annotations.find((annotation) => annotation.recordId === undefined && annotation.address === cell.address)
  }
  if (cell.bound) return annotations.find((annotation) => annotation.recordId === undefined && annotation.address === cell.address)
  return annotations.find((annotation) => annotation.address === cell.address)
}

export function annotationFor(
  annotations: readonly CellAnnotation[],
  address: string,
): CellAnnotation | undefined {
  return annotations.find((annotation) => annotation.address === address)
}
