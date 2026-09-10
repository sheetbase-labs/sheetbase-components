/**
 * Special functions and statistical distributions for the spreadsheet
 * function library — the numerics behind the NORM/T/CHISQ/F/CONFIDENCE
 * families (parity tier C, the distribution functions).
 *
 * Algorithms are the standard, battle-tested ones (Numerical Recipes):
 * Lanczos log-gamma, series + continued-fraction regularised incomplete
 * gamma, continued-fraction regularised incomplete beta, erfc through the
 * incomplete gamma, and bracketed bisection for the inverse CDFs. Accuracy
 * is ~1e-13 relative on the covered domain — comfortably beyond what a
 * spreadsheet cell displays.
 *
 * All inverse CDFs use expanding-bracket bisection on a strictly monotone
 * CDF: slower than Newton but unconditionally stable, and spreadsheet
 * evaluation is not a hot loop.
 */
/** log Γ(x) for x > 0 — Lanczos approximation (g = 5, n = 6). */
export declare function gammln(x: number): number;
/** Complementary error function for x ≥ 0, via the upper incomplete gamma. */
export declare function erfc(x: number): number;
/** Standard normal CDF. */
export declare function normalCdf(z: number): number;
/** Regularised lower incomplete gamma P(a, x). */
export declare function gammaP(a: number, x: number): number;
/** Regularised upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export declare function gammaQ(a: number, x: number): number;
/** Regularised incomplete beta I_x(a, b). */
export declare function betaI(a: number, b: number, x: number): number;
/** Inverse of a strictly increasing CDF on [0, ∞) by expanding bisection. */
export declare function invertIncreasing(cdf: (x: number) => number, target: number): number;
/** Standard normal inverse CDF. Symmetric about 0.5 so lower-tail probabilities stay negative. */
export declare function normalInverse(p: number): number;
/** Chi-squared PDF. */
export declare function chiSquaredPdf(x: number, degreesOfFreedom: number): number;
/** Chi-squared CDF. */
export declare function chiSquaredCdf(x: number, degreesOfFreedom: number): number;
/** Student t PDF. */
export declare function tPdf(x: number, degreesOfFreedom: number): number;
/** Student t CDF (both tails by symmetry). */
export declare function tCdf(x: number, degreesOfFreedom: number): number;
/** F PDF. */
export declare function fPdf(x: number, d1: number, d2: number): number;
/** F CDF. */
export declare function fCdf(x: number, d1: number, d2: number): number;
export interface NormalSummary {
    mean: number;
    variance: number;
    count: number;
}
/** Mean/variance of a flat sample; empty samples raise #DIV/0!. */
export declare function sampleSummary(values: number[], population?: boolean): NormalSummary;
