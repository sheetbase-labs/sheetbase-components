import { type ReactNode } from "react";
import type { CellFormat, CellRange } from "../engine";
import type { ConditionalFormatRule } from "../grid/conditional-formatting";
import type { ThemeMode } from "./presentation-state";
export type TableSurfaceProps = Readonly<{
    table: ReactNode;
    companion?: ReactNode;
    companionWidth?: number;
    className?: string;
    action?: ReactNode;
    theme?: "light" | "dark";
    objects?: readonly TableSurfaceObject[];
    /**
     * Draw the surface frame (border, surround, companion layout). Default true
     * for the Million-style wrapper; false renders just the table, e.g. Bare.
     */
    frame?: boolean;
}>;
export type TableSurfaceObject = Readonly<{
    id: string;
    placement: "right" | "bottom";
    size: number;
    content: ReactNode;
    onResize?(size: number): void;
}>;
/** A compact work surface that can grow to hold table-adjacent tools and charts. */
export declare function TableSurface({ table, companion, companionWidth, className, action, theme, objects, frame }: TableSurfaceProps): import("react").JSX.Element;
export type TableFormattingToolbarProps = Readonly<{
    selection: string;
    onFormat(format: Partial<CellFormat>): void;
    format?: Partial<CellFormat>;
    mixedFormats?: readonly (keyof CellFormat)[];
    theme?: "light" | "dark";
    /** Stored mode; the toggle cycles light → dark → system. Defaults to the resolved theme. */
    themeMode?: ThemeMode;
    onThemeChange?(mode: ThemeMode): void;
    viewControls?: ReactNode;
    /** Replaces the built-in light-mode colour palette. */
    colours?: readonly string[];
    /** Replaces the built-in dark-mode palette; falls back to `colours` when omitted. */
    darkColours?: readonly string[];
    defaultTextColour?: string;
    defaultFillColour?: string;
}>;
export declare function TableFormattingToolbar({ selection, onFormat, format, mixedFormats, theme, themeMode, onThemeChange, viewControls, colours, darkColours, defaultTextColour, defaultFillColour }: TableFormattingToolbarProps): import("react").JSX.Element;
export type ConditionalFormattingInspectorProps = Readonly<{
    fieldId: string;
    fields?: readonly Readonly<{
        id: string;
        label: string;
        options?: readonly string[];
    }>[];
    onFieldChange?(fieldId: string): void;
    selectionRange?: CellRange;
    selectionLabel?: string;
    rules: readonly ConditionalFormatRule[];
    onRulesChange(rules: readonly ConditionalFormatRule[]): void;
    onClose(): void;
}>;
export declare function ConditionalFormattingInspector({ fieldId, fields, onFieldChange, selectionRange, selectionLabel, rules, onRulesChange, onClose }: ConditionalFormattingInspectorProps): import("react").JSX.Element;
