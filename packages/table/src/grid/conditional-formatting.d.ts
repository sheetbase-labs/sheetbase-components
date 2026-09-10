import type { CellFormat, CellRange } from "../engine";
import type { GridPoint } from "./model";
export type ConditionalFormatOperator = "equals" | "notEquals" | "contains" | "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual" | "between" | "isBlank" | "isNotBlank";
export type ConditionalFormatRule = Readonly<{
    id?: string;
    fieldId?: string;
    conditionFieldId?: string;
    applyTo?: "cell" | "column" | "row" | "range";
    targetFieldId?: string;
    enabled?: boolean;
    range?: CellRange;
    operator: ConditionalFormatOperator;
    value?: string | number;
    value2?: string | number;
    format: Partial<CellFormat>;
    stopIfTrue?: boolean;
    colorScale?: Readonly<{
        min: number;
        midpoint: number;
        max: number;
        minColor: string;
        midpointColor: string;
        maxColor: string;
    }>;
}>;
export declare function conditionalFormatMatches(rule: ConditionalFormatRule, value: string): boolean;
/** Later matching rules override earlier properties, unless a rule stops evaluation. */
export declare function resolveConditionalFormat(point: GridPoint, value: string, fieldId: string | undefined, rules: readonly ConditionalFormatRule[], valueForField?: (fieldId: string) => string): Partial<CellFormat> | undefined;
