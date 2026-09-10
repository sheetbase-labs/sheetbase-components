/**
 * Per-cell annotations (Phase 2): provenance notes and review comments
 * attached to cell addresses. Stored as plain arrays in presentation state
 * (JSON-serialisable) and rendered as an overlay indicator by the grid.
 */
export interface CellAnnotation {
    address: string;
    text: string;
    author?: string;
    createdAt?: string;
}
export declare function normaliseCellAnnotations(value: unknown): CellAnnotation[];
/** Immutable set: replaces the annotation on an address or appends a new one. */
export declare function setAnnotation(annotations: readonly CellAnnotation[], address: string, text: string, meta?: {
    author?: string;
    createdAt?: string;
}): CellAnnotation[];
export declare function removeAnnotation(annotations: readonly CellAnnotation[], address: string): CellAnnotation[];
export declare function annotationFor(annotations: readonly CellAnnotation[], address: string): CellAnnotation | undefined;
