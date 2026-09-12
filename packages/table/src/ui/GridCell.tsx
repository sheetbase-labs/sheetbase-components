import { memo, type ReactNode, type RefObject } from "react";
import type { CellFormat } from "../engine/types";
import type { GridPoint } from "../grid/model";
import type { FieldWrite, SpreadsheetCellRenderContext, WriteStatus } from "./Spreadsheet";

export type GridCellWriteState = Readonly<{
  status: WriteStatus;
  write: FieldWrite;
  before?: string;
}>;

/**
 * Interaction callbacks for grid cells. The parent hands a stable ref whose
 * `current` is reassigned every render, so memoized cells always invoke the
 * latest closures without their prop identity ever changing.
 */
export interface GridCellHandlers {
  pointerDown(point: GridPoint, event: React.PointerEvent<HTMLDivElement>): void;
  pointerEnter(point: GridPoint): void;
  doubleClick(point: GridPoint): void;
  badgeClick(address: string, writeState: GridCellWriteState, event: React.MouseEvent<HTMLButtonElement>): void;
}

export interface GridCellProps {
  address: string;
  row: number;
  column: number;
  /** Formatted display text (the `value` the cell paints). */
  display: string;
  /** Whether the raw input is a formula (drives the `formula-value` class). */
  isFormula: boolean;
  selected: boolean;
  active: boolean;
  loading: boolean;
  /** Precomputed className — built by the parent from the same flags as before. */
  className: string;
  /** Annotation tooltip text (`author: text`), undefined when unannotated. */
  title?: string;
  /** Resolved format (base merged with any conditional format). */
  format?: Partial<CellFormat>;
  field?: SpreadsheetCellRenderContext["field"];
  writeState?: GridCellWriteState;
  renderCell?(context: SpreadsheetCellRenderContext): ReactNode | undefined;
  handlers: RefObject<GridCellHandlers>;
  left: number | string;
  top: number | string;
  width: number;
  height: number;
}

function sameFormat(a?: Partial<CellFormat>, b?: Partial<CellFormat>): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.numberFormat === b.numberFormat
    && a.background === b.background
    && a.foreground === b.foreground
    && a.fontWeight === b.fontWeight
    && a.horizontalAlign === b.horizontalAlign;
}

/**
 * One grid cell. Memoized so scroll/selection renders only repaint cells whose
 * inputs actually changed; interaction goes through the `handlers` ref so the
 * memo is not defeated by fresh closures each parent render.
 */
export const GridCell = memo(function GridCell(props: GridCellProps) {
  const { address, row, column, display, isFormula, selected, active, loading, className, title, format, field, writeState, renderCell, handlers, left, top, width, height } = props;
  const point: GridPoint = { row, column };
  const context: SpreadsheetCellRenderContext = { address, point, display, field, selected, active, loading };
  return (
    // biome-ignore lint/a11y/useSemanticElements: virtualised grid — cells are absolutely positioned divs; the ARIA gridcell role is the sanctioned pattern
    <div
      role="gridcell"
      tabIndex={-1}
      aria-selected={selected}
      className={className}
      title={title}
      style={{
        left,
        top,
        width,
        height,
        fontWeight: format?.fontWeight,
        textAlign: format?.horizontalAlign,
        justifyContent: format?.horizontalAlign === "right" ? "flex-end" : format?.horizontalAlign === "center" ? "center" : undefined,
        color: format?.foreground,
        backgroundColor: format?.background,
      }}
      onPointerDown={(event) => handlers.current?.pointerDown(point, event)}
      onPointerEnter={() => handlers.current?.pointerEnter(point)}
      onDoubleClick={() => handlers.current?.doubleClick(point)}
    >
      {loading ? <span className="loading-placeholder" /> : renderCell?.(context) ?? <span className={`${isFormula ? "formula-value" : ""}${display.includes("\n") ? " multiline" : ""}`}>{display}</span>}
      {writeState && <button type="button" className="write-state" aria-label={`${writeState.status} write`} title={writeState.status === "failed" || writeState.status === "conflict" ? "Click to retry; Shift-click to revert" : writeState.status} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => handlers.current?.badgeClick(address, writeState, event)} />}
    </div>
  );
}, (prev, next) =>
  prev.address === next.address
  && prev.row === next.row
  && prev.column === next.column
  && prev.display === next.display
  && prev.isFormula === next.isFormula
  && prev.selected === next.selected
  && prev.active === next.active
  && prev.loading === next.loading
  && prev.className === next.className
  && prev.title === next.title
  && sameFormat(prev.format, next.format)
  && prev.field === next.field
  && prev.writeState === next.writeState
  && prev.renderCell === next.renderCell
  && prev.handlers === next.handlers
  && prev.left === next.left
  && prev.top === next.top
  && prev.width === next.width
  && prev.height === next.height);
