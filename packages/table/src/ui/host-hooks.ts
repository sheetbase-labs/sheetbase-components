import { parseAddress } from "../engine/coordinates";
import type { GridMutation } from "../grid/mutations";
import { parseTsv } from "../grid/model";
import type { GridPoint } from "../grid/model";

/**
 * Host hook contracts for the low-level `Spreadsheet` renderer. These are the
 * seams a bound host (an ELN sheet, an external dataset) needs to keep its own
 * data-integrity rules in front of the grid's local commit pipeline:
 *
 * - `beforeCellsChange` gates a mutation *before* it is applied;
 * - `SpreadsheetClipboard` gates/transforms clipboard payloads and surfaces cut
 *   status;
 * - `SpreadsheetMenuAction` extends the column header menu;
 * - `SpreadsheetCustomEditor` renders a hosted cell editor per column;
 * - `cellDisplayText` separates a cell's stored value from its rendered label;
 * - `onSortChange` / `onFiltersChange` notify the host of the presentation
 *   surface.
 *
 * The decision logic lives here as pure functions so it is unit-testable and
 * the component only wires stateful effects around it.
 */

/**
 * Which grid operation proposed a change. Mirrors the sources a bound host
 * cares about: direct edits, pastes, fills, clears, range moves, find/replace,
 * structural edits, local sorts and conflict reverts.
 */
export type SpreadsheetMutationSource =
  | "edit"
  | "paste"
  | "fill"
  | "clear"
  | "move"
  | "replace"
  | "structure"
  | "sort"
  | "revert";

/**
 * A proposed cell change handed to `beforeCellsChange`. `next` is the value the
 * grid will apply; assign to it to replace the proposed value, or leave it to
 * keep the grid's proposal. `recordId`/`fieldId` identify the bound target when
 * the grid has a dataset header, so the host can validate per record.
 *
 * `editable: false` marks a cell in the operation's intended target set that the
 * grid will *not* write (a read-only row, a read-only column or field). Return
 * `false` to refuse the operation as a whole instead of letting the editable
 * subset apply. The field is absent on every cell the grid will write.
 */
export type SpreadsheetCellChange = {
  address: string;
  row: number;
  column: number;
  recordId?: string;
  fieldId?: string;
  before?: string;
  next?: string;
  editable?: boolean;
};

/**
 * Pre-commit gate. Return `false` to reject the whole change set before
 * anything is applied (no history entry, no field writes, no `onMutation`);
 * assign to `change.next` to replace individual proposed values. Returning
 * nothing or `true` accepts the (possibly edited) changes.
 *
 * For bulk operations (paste, fill, clear, move) the change list is the full
 * intended target set, so a change with `editable: false` marks a cell the grid
 * would otherwise skip — a host that must not write partially returns `false`.
 */
export type SpreadsheetBeforeCellsChange = (
  changes: SpreadsheetCellChange[],
  source: SpreadsheetMutationSource,
  // biome-ignore lint/suspicious/noConfusingVoidType: hosts accept a change by returning nothing
) => boolean | void;

/** The header shape the pre-commit gate needs to resolve bound identity. */
export type BeforeCellsChangeHeader = Readonly<{
  recordIdForRow?(row: number): string | undefined;
  fields: readonly Readonly<{ id: string; column: number }>[];
}>;

/** Resolves each mutation cell into the host-facing change shape, in address order. */
export function buildCellChanges(
  mutation: GridMutation,
  header?: BeforeCellsChangeHeader,
): SpreadsheetCellChange[] {
  const changes: SpreadsheetCellChange[] = [];
  // A bulk mutation carries its full intended target set; every entry is
  // reported, with `editable: false` on the targets the grid will skip.
  const applied = new Map(mutation.cells.map((cell) => [cell.address, cell]));
  for (const cell of mutation.intended ?? mutation.cells) {
    let point: GridPoint;
    try {
      point = parseAddress(cell.address);
    } catch {
      continue;
    }
    const appliedCell = applied.get(cell.address);
    const field = header?.fields.find((item) => item.column === point.column);
    const skipped = mutation.intended !== undefined && appliedCell === undefined;
    changes.push({
      address: cell.address,
      row: point.row,
      column: point.column,
      recordId: header?.recordIdForRow?.(point.row),
      fieldId: field?.id,
      before: appliedCell ? appliedCell.before : cell.before,
      next: appliedCell ? appliedCell.after : cell.after,
      ...(skipped ? { editable: false } : {}),
    });
  }
  return changes;
}

/**
 * Runs the pre-commit gate against a mutation. Returns the mutation to apply
 * (with any host-replaced values) or `undefined` when the host rejected it.
 * Mutations with neither applied cells nor an intended target set bypass the
 * gate.
 */
export function resolveBeforeCellsChange(
  hook: SpreadsheetBeforeCellsChange | undefined,
  mutation: GridMutation,
  source: SpreadsheetMutationSource,
  header?: BeforeCellsChangeHeader,
): GridMutation | undefined {
  if (!hook || (mutation.cells.length === 0 && (mutation.intended?.length ?? 0) === 0)) return mutation;
  const changes = buildCellChanges(mutation, header);
  if (hook(changes, source) === false) return undefined;
  // Host replacements only take effect for cells the grid will actually write;
  // an intended-only (non-editable) target can be vetoed but never written.
  const nextByAddress = new Map(mutation.cells.map((cell) => [cell.address, cell.after]));
  for (const change of changes) {
    if (nextByAddress.has(change.address)) nextByAddress.set(change.address, change.next);
  }
  let changed = false;
  const cells = mutation.cells.map((cell) => {
    const next = nextByAddress.get(cell.address);
    if (next === cell.after) return cell;
    changed = true;
    return { ...cell, after: next === undefined ? undefined : next };
  });
  return changed ? { ...mutation, cells } : mutation;
}

/** The display range copied/cut/pasted, with the stable column ids it covers. */
export type SpreadsheetClipboardRange = Readonly<{
  top: number;
  left: number;
  bottom: number;
  right: number;
  columnIds: readonly (string | undefined)[];
}>;

/** The clipboard payload a host sees and may transform. */
export type SpreadsheetClipboardPayload = {
  /** TSV text written to (or read from) the clipboard. */
  text: string;
  /** The same content parsed into rows of values. */
  values: readonly (readonly string[])[];
  range: SpreadsheetClipboardRange;
};

/** A hook may accept (return nothing/`true`), cancel (`false`) or replace the payload. */
export type SpreadsheetClipboardOverride =
  | boolean
  | SpreadsheetClipboardPayload
  // biome-ignore lint/suspicious/noConfusingVoidType: hosts accept a payload by returning nothing
  | void;

/** Cut status surfaced while a cut range is pending. */
export type SpreadsheetCutStatus = Readonly<{
  label: string;
  range: SpreadsheetClipboardRange;
}>;

/** Clipboard gates so a host can veto or transform copy/cut/paste. */
export type SpreadsheetClipboard = Readonly<{
  /** Before copy writes to the clipboard. Return `false` to cancel; return a payload to transform. */
  onCopy?(payload: SpreadsheetClipboardPayload): SpreadsheetClipboardOverride;
  /** Before cut clears the source. Return `false` to cancel the cut; return a payload to transform. */
  onCut?(payload: SpreadsheetClipboardPayload): SpreadsheetClipboardOverride;
  /** Before paste applies. Return `false` to cancel; return a payload to transform the pasted text. */
  onPaste?(
    payload: SpreadsheetClipboardPayload,
    target: { row: number; column: number },
  ): SpreadsheetClipboardOverride;
  /** Cut started (`status`) or was cleared (`null`), so a host can surface it. */
  onCutStatusChange?(status: SpreadsheetCutStatus | null): void;
}>;

/**
 * Applies a clipboard hook result to a payload. Returns the payload to use, or
 * `undefined` when the host cancelled. A replaced payload keeps the original
 * range unless the host supplied one, and re-parses `values` from new text.
 */
export function resolveClipboardPayload(
  result: SpreadsheetClipboardOverride,
  payload: SpreadsheetClipboardPayload,
): SpreadsheetClipboardPayload | undefined {
  if (result === false) return undefined;
  if (result === undefined || result === true) return payload;
  const range = result.range ?? payload.range;
  if (result.text === payload.text) return { ...payload, range };
  return { text: result.text, values: parseTsv(result.text), range };
}

/** The column shape `cellDisplayText` needs: a stored-value → label mapper. */
export type DisplayTextColumn = Readonly<{
  displayText?: (storedValue: string) => string | undefined;
}>;

/**
 * Separates a cell's stored value from its rendered text: a host's
 * `displayText` label wins over the built-in formatting, so bound writes keep
 * the real value (record id, category key) while the grid shows the label.
 */
export function cellDisplayText(
  column: DisplayTextColumn | undefined,
  storedValue: string,
  formatted: string,
): string {
  return column?.displayText?.(storedValue) ?? formatted;
}

/** Context a hosted cell editor matches and renders against. */
export type SpreadsheetEditorMatch<Field = unknown> = Readonly<{
  point: GridPoint;
  /** Stable column id (`fieldIds[column]`), present for bound/local columns. */
  columnId?: string;
  field?: Field;
}>;

/** First editor whose `matches` accepts the context; the built-in input is used when none match. */
export function selectCustomEditor<Context, Editor extends { matches(context: Context): boolean }>(
  editors: readonly Editor[] | undefined,
  context: Context,
): Editor | undefined {
  return editors?.find((editor) => editor.matches(context));
}

/** Structural equality for query clause lists (sort/filter notification). */
export function sameClauses<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => JSON.stringify(entry) === JSON.stringify(right[index]));
}

/** Menu entries that are not disabled at the current moment. */
export function enabledMenuActions<T extends { disabled?(): boolean }>(
  actions: readonly T[] | undefined,
): T[] {
  return (actions ?? []).filter((action) => action.disabled?.() !== true);
}
