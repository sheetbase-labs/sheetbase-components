import { useCallback, useEffect, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

export type PortalPopoverRefs = Readonly<{
  popover: RefObject<HTMLElement | null>;
  root?: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
}>;

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared keyboard contract for portal popovers: focus moves in on open,
 * Tab wraps inside, Escape closes and restores focus to the trigger, and
 * focus leaving both popover and trigger closes the popover.
 */
export function usePortalPopover(open: boolean, onClose: () => void, refs: PortalPopoverRefs): Readonly<{ onKeyDown(event: KeyboardEvent): void; onBlurOut(event: FocusEvent): void }> {
  useEffect(() => {
    if (!open) return;
    const popover = refs.popover.current;
    if (!popover) return;
    const first = popover.querySelector<HTMLElement>(focusableSelector) ?? popover;
    first.focus();
    // biome-ignore lint/correctness/useExhaustiveDependencies: focuses on open transitions only; popover contents shouldn't retrigger it.
  }, [open]);

  return {
    onKeyDown: useCallback((event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        refs.trigger?.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const popover = refs.popover.current;
      if (!popover) return;
      const focusables = Array.from(popover.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }, [onClose, refs]),
    onBlurOut: useCallback((event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next) return;
      if (refs.popover.current?.contains(next)) return;
      if (refs.root?.current?.contains(next)) return;
      onClose();
    }, [onClose, refs]),
  };
}
