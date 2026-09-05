import type { CellFormat, CellRange } from "../engine";
import type { GridPoint } from "./model";

export type ConditionalFormatOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "between"
  | "isBlank"
  | "isNotBlank";

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

function mixHex(start: string, end: string, amount: number) {
  const read = (value: string) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const from = read(start);
  const to = read(end);
  return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function scaleColor(value: string, scale: NonNullable<ConditionalFormatRule["colorScale"]>) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric <= scale.midpoint) {
    const span = scale.midpoint - scale.min;
    return mixHex(scale.minColor, scale.midpointColor, span === 0 ? 1 : Math.max(0, Math.min(1, (numeric - scale.min) / span)));
  }
  const span = scale.max - scale.midpoint;
  return mixHex(scale.midpointColor, scale.maxColor, span === 0 ? 1 : Math.max(0, Math.min(1, (numeric - scale.midpoint) / span)));
}

function inRange(point: GridPoint, range?: CellRange) {
  if (!range) return true;
  const top = Math.min(range.start.row, range.end.row);
  const bottom = Math.max(range.start.row, range.end.row);
  const left = Math.min(range.start.column, range.end.column);
  const right = Math.max(range.start.column, range.end.column);
  return point.row >= top && point.row <= bottom && point.column >= left && point.column <= right;
}

export function conditionalFormatMatches(rule: ConditionalFormatRule, value: string): boolean {
  const expected = String(rule.value ?? "");
  const actualNumber = Number(value);
  const expectedNumber = Number(rule.value);
  const numeric = value.trim() !== "" && Number.isFinite(actualNumber) && Number.isFinite(expectedNumber);
  switch (rule.operator) {
    case "equals": return value.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0;
    case "notEquals": return value.localeCompare(expected, undefined, { sensitivity: "accent" }) !== 0;
    case "contains": return value.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case "greaterThan": return numeric && actualNumber > expectedNumber;
    case "greaterThanOrEqual": return numeric && actualNumber >= expectedNumber;
    case "lessThan": return numeric && actualNumber < expectedNumber;
    case "lessThanOrEqual": return numeric && actualNumber <= expectedNumber;
    case "between": {
      const upper = Number(rule.value2);
      return numeric && Number.isFinite(upper) && actualNumber >= expectedNumber && actualNumber <= upper;
    }
    case "isBlank": return value.trim() === "";
    case "isNotBlank": return value.trim() !== "";
  }
}

/** Later matching rules override earlier properties, unless a rule stops evaluation. */
export function resolveConditionalFormat(
  point: GridPoint,
  value: string,
  fieldId: string | undefined,
  rules: readonly ConditionalFormatRule[],
  valueForField?: (fieldId: string) => string,
): Partial<CellFormat> | undefined {
  let resolved: Partial<CellFormat> | undefined;
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const targetFieldId = rule.applyTo === "column" ? rule.targetFieldId ?? rule.fieldId : rule.fieldId;
    if (rule.applyTo !== "row" && rule.applyTo !== "range" && targetFieldId !== undefined && targetFieldId !== fieldId) continue;
    const conditionFieldId = rule.conditionFieldId ?? rule.fieldId;
    const conditionValue = conditionFieldId && conditionFieldId !== fieldId ? valueForField?.(conditionFieldId) ?? "" : value;
    if (rule.colorScale) {
      if (!inRange(point, rule.range)) continue;
      const background = scaleColor(conditionValue, rule.colorScale);
      if (background) resolved = { ...resolved, ...rule.format, background };
      if (background && rule.stopIfTrue) break;
      continue;
    }
    if (!inRange(point, rule.range) || !conditionalFormatMatches(rule, conditionValue)) continue;
    resolved = { ...resolved, ...rule.format };
    if (rule.stopIfTrue) break;
  }
  return resolved;
}
