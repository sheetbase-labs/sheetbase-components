const referencePattern = /(\[[^\]]+\]|(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Z]+\$?[1-9]\d*(?::(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*!)?\$?[A-Z]+\$?[1-9]\d*)?)/g;
const colours = ["reference-green", "reference-orange", "reference-blue", "reference-purple"];

export type FormulaTokenPart = Readonly<{ text: string; colour?: string }>;

export function formulaTokenParts(value: string): readonly FormulaTokenPart[] {
  const indexes = new Map<string, number>();
  const parts: FormulaTokenPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(referencePattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: value.slice(cursor, start) });
    const key = match[0].toUpperCase();
    if (!indexes.has(key)) indexes.set(key, indexes.size);
    parts.push({ text: match[0], colour: colours[indexes.get(key)! % colours.length] });
    cursor = start + match[0].length;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) });
  return parts;
}

export function FormulaTokens({ value, className = "formula-tokens", style }: Readonly<{ value: string; className?: string; style?: CSSProperties }>) {
  const parts = formulaTokenParts(value);
  return <span className={className} style={style} aria-hidden="true">{parts.map((part, index) => <span className={part.colour} key={index}>{part.text}</span>)}</span>;
}
import type { CSSProperties } from "react";
