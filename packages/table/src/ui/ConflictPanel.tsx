import { useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { RecordFieldWrite } from "../data/adapter";
import { conflictKey, conflictRows, type RevisionConflict } from "../data/conflicts";
import { usePortalPopover } from "./use-portal-popover";

export type ConflictPanelEntry = Readonly<{
  conflict: RevisionConflict;
  write: RecordFieldWrite;
  currentRevision: string;
}>;

export type ConflictPanelProps = Readonly<{
  conflicts: readonly ConflictPanelEntry[];
  fieldLabels?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  trigger?: RefObject<HTMLElement | null>;
  onKeepMine(entry: ConflictPanelEntry, index: number): void;
  onTakeServer(entry: ConflictPanelEntry, index: number): void;
  onKeepAll(): void;
  onTakeAll(): void;
  onClose(): void;
}>;

/** Lists one row per revision conflict with per-row and resolve-all actions. Renders in a portal. */
export function ConflictPanel({
  conflicts,
  fieldLabels,
  trigger,
  onKeepMine,
  onTakeServer,
  onKeepAll,
  onTakeAll,
  onClose,
}: ConflictPanelProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  usePortalPopover(true, onClose, { popover: popoverRef, trigger });
  const rows = conflictRows(conflicts.map((entry) => entry.conflict), fieldLabels);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Save conflicts"
      className="conflict-panel"
      tabIndex={-1}
    >
      <header>
        <strong>Save conflicts</strong>
        <small>{conflicts.length}</small>
        <button type="button" aria-label="Close conflicts" onClick={onClose}>×</button>
      </header>
      <ul>
        {rows.map((row, index) => {
          const entry = conflicts[index];
          if (!entry) return null;
          return <li key={conflictKey(entry.conflict)}>
            <div className="conflict-field">
              <strong title={row.fieldId}>{row.fieldLabel}</strong>
              <small title={row.recordId}>{row.recordId} · {row.reason}</small>
            </div>
            <dl>
              <div><dt>Mine</dt><dd title={row.mine ?? ""}>{row.mine ?? "—"}</dd></div>
              <div><dt>Server</dt><dd title={row.server ?? ""}>{row.server ?? "—"}</dd></div>
            </dl>
            <div className="conflict-actions">
              <button type="button" onClick={() => onKeepMine(entry, index)}>Keep mine</button>
              <button type="button" onClick={() => onTakeServer(entry, index)}>Take server</button>
            </div>
          </li>;
        })}
      </ul>
      <footer>
        <span>Resolve all</span>
        <button type="button" onClick={onKeepAll}>Keep all mine</button>
        <button type="button" onClick={onTakeAll}>Take all server</button>
      </footer>
    </div>,
    document.body,
  );
}
