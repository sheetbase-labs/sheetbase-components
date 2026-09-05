# Accessibility

The grid follows the WAI-ARIA grid pattern. This page documents the current contract; the popover and menu behaviour is covered in [components.md](components.md).

## Roles and semantics

- The viewport is `role="grid"` with `aria-rowcount` / `aria-colcount` and `aria-busy` while requested cells load.
- Cells are `role="gridcell"` with `aria-selected`; row and column headers are `role="rowheader"` / `role="columnheader"` with `aria-selected` reflecting the active selection.
- Formula suggestions render as a `listbox` with `role="option"` children; the cell editor points at the highlighted suggestion through `aria-activedescendant`.
- The typed-options picker in the cell editor is a `radiogroup` (boolean) or `listbox` (options, relationship).
- Validation problems are announced through a `role="alert"` element; write outcomes through the live region below.
- Surface-object resizers are `role="separator"` and resize with arrow keys.

## Announcements

A polite live region (`.grid-announcer`) reports:

- selection changes — the active address for one cell, or the count plus range for multi-cell selections;
- write outcomes — saving, saved, save failed and save conflict, one announcement per newly written field.

Announcements are debounced by 150 ms so arrow-key navigation does not flood screen readers.

## Keyboard model

| Action | Keys |
| --- | --- |
| Move / extend selection | Arrows, Shift + arrows, Tab |
| Edit cell | Enter, F2, double-click or direct typing |
| Commit / cancel edit | Enter / Tab · Escape |
| Absolute reference cycling in formulas | F4 |
| Copy, cut, paste, paste values | Platform clipboard shortcuts |
| Undo / redo | Cmd/Ctrl+Z · Cmd/Ctrl+Shift+Z · Cmd/Ctrl+Y |
| Find / replace | Cmd/Ctrl+F · Cmd/Ctrl+Shift+F or Cmd/Ctrl+H |
| Clear range | Delete or Backspace |
| Shortcut help | `?` |
| Column context menu | `Menu` or `Shift+F10` on the focused grid |
| Popovers and menus | Tab wraps inside; Escape closes and returns focus to the trigger |

Hosts embedding the grid must keep the viewport focusable and avoid `tabindex` traps around it; `SpreadsheetHandle.focus()` restores grid focus after closing host-owned panels.
