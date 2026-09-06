/**
 * Per-cell annotations (Phase 2): provenance notes and review comments
 * attached to cell addresses. Stored as plain arrays in presentation state
 * (JSON-serialisable) and rendered as an overlay indicator by the grid.
 */
export interface CellAnnotation {
  address: string
  text: string
  author?: string
  createdAt?: string
}

export function normaliseCellAnnotations(value: unknown): CellAnnotation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const candidate = entry as { address?: unknown; text?: unknown; author?: unknown; createdAt?: unknown }
    if (typeof candidate.address !== "string" || typeof candidate.text !== "string") return []
    if (candidate.text === "") return []
    return [{
      address: candidate.address,
      text: candidate.text,
      ...(typeof candidate.author === "string" ? { author: candidate.author } : {}),
      ...(typeof candidate.createdAt === "string" ? { createdAt: candidate.createdAt } : {}),
    }]
  })
}

/** Immutable set: replaces the annotation on an address or appends a new one. */
export function setAnnotation(
  annotations: readonly CellAnnotation[],
  address: string,
  text: string,
  meta?: { author?: string; createdAt?: string },
): CellAnnotation[] {
  const trimmed = text.trim()
  const others = annotations.filter((annotation) => annotation.address !== address)
  if (trimmed === "") return others
  return [
    ...others,
    {
      address,
      text: trimmed,
      ...(meta?.author ? { author: meta.author } : {}),
      ...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
    },
  ]
}

export function removeAnnotation(annotations: readonly CellAnnotation[], address: string): CellAnnotation[] {
  return annotations.filter((annotation) => annotation.address !== address)
}

export function annotationFor(
  annotations: readonly CellAnnotation[],
  address: string,
): CellAnnotation | undefined {
  return annotations.find((annotation) => annotation.address === address)
}
