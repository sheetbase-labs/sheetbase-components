export type FormulaTokenPart = Readonly<{
    text: string;
    colour?: string;
}>;
export declare function formulaTokenParts(value: string): readonly FormulaTokenPart[];
export declare function FormulaTokens({ value, className, style }: Readonly<{
    value: string;
    className?: string;
    style?: CSSProperties;
}>): import("react").JSX.Element;
import type { CSSProperties } from "react";
