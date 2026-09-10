import { type FocusEvent, type KeyboardEvent, type RefObject } from "react";
export type PortalPopoverRefs = Readonly<{
    popover: RefObject<HTMLElement | null>;
    root?: RefObject<HTMLElement | null>;
    trigger?: RefObject<HTMLElement | null>;
}>;
/**
 * Shared keyboard contract for portal popovers: focus moves in on open,
 * Tab wraps inside, Escape closes and restores focus to the trigger, and
 * focus leaving both popover and trigger closes the popover.
 */
export declare function usePortalPopover(open: boolean, onClose: () => void, refs: PortalPopoverRefs): Readonly<{
    onKeyDown(event: KeyboardEvent): void;
    onBlurOut(event: FocusEvent): void;
}>;
