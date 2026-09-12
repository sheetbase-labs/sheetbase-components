import { useEffect, useRef, type RefObject } from "react";

export type PortalPopoverRefs = Readonly<{
  popover: RefObject<HTMLElement | null>;
  root?: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
}>;

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared keyboard contract for portal popovers: focus moves in on open,
 * Tab wraps inside, Escape closes and restores focus to the trigger, and
 * focus leaving both popover and trigger closes the popover. Listeners are
 * attached natively so the popover container carries no JSX handlers.
 */
export function usePortalPopover(open: boolean, onClose: () => void, refs: PortalPopoverRefs): void {
  const { popover: popoverRef, root: rootRef, trigger: triggerRef } = refs;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const first = popover.querySelector<HTMLElement>(focusableSelector) ?? popover;
    first.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        triggerRef?.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(popover.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusables.length === 0) return;
      const firstFocusable = focusables[0];
      const lastFocusable = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) { event.preventDefault(); lastFocusable?.focus(); }
      else if (!event.shiftKey && document.activeElement === lastFocusable) { event.preventDefault(); firstFocusable?.focus(); }
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next) return;
      if (popoverRef.current?.contains(next)) return;
      if (rootRef?.current?.contains(next)) return;
      onCloseRef.current();
    };
    popover.addEventListener("keydown", onKey);
    popover.addEventListener("focusout", onFocusOut);
    return () => {
      popover.removeEventListener("keydown", onKey);
      popover.removeEventListener("focusout", onFocusOut);
    };
  }, [open, popoverRef, rootRef, triggerRef]);
}
