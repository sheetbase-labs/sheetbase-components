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

const LOG_SQRT_2PI = 0.9189385332046727; // log(sqrt(2 * PI))

/** log Γ(x) for x > 0 — Lanczos approximation (g = 5, n = 6). */
export function gammln(x: number): number {
  if (x <= 0) throw new Error("#NUM!");
  const cof = [
    76.18009172947146,
    // biome-ignore lint/correctness/noPrecisionLoss: canonical Lanczos log-gamma coefficients — the excess digits are how the published constants are written.
    -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  // biome-ignore lint/correctness/noPrecisionLoss: canonical Lanczos log-gamma coefficients — the excess digits are how the published constants are written.
  let series = 1.000000000190015;
  for (let j = 0; j < 6; j++) series += cof[j] / ++y;
  // biome-ignore lint/correctness/noPrecisionLoss: same Lanczos series — published constant.
  return -tmp + Math.log(2.5066282746310005 * series / x);
}

/** Complementary error function for x ≥ 0, via the upper incomplete gamma. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  return gammaQ(0.5, x * x);
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (a <= 0 || x < 0) throw new Error("#NUM!");
  if (x === 0) return 0;
  if (x < a + 1) return gammaSeries(a, x);
  return 1 - gammaContinued(a, x);
}

/** Regularised upper incomplete gamma Q(a, x) = 1 − P(a, x). */
export function gammaQ(a: number, x: number): number {
  if (a <= 0 || x < 0) throw new Error("#NUM!");
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaContinued(a, x);
}

function gammaSeries(a: number, x: number): number {
  const maxIterations = 500;
  const epsilon = 3e-14;
  let ap = a;
  let sum = 1 / a;
  let delta = sum;
  for (let n = 1; n <= maxIterations; n++) {
    ap += 1;
    delta *= x / ap;
    sum += delta;
    if (Math.abs(delta) < Math.abs(sum) * epsilon) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammln(a));
}

function gammaContinued(a: number, x: number): number {
  const maxIterations = 500;
  const epsilon = 3e-14;
  const floor = Number.MIN_VALUE / epsilon;
  let b = x + 1 - a;
  let c = 1 / floor;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= maxIterations; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < floor) d = floor;
    c = b + an / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaI(a: number, b: number, x: number): number {
  if (a <= 0 || b <= 0) throw new Error("#NUM!");
  if (x < 0 || x > 1) throw new Error("#NUM!");
  if (x === 0 || x === 1) return x;
  const front = Math.exp(
    gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinued(a, b, x)) / a;
  return 1 - (front * betaContinued(b, a, 1 - x)) / b;
}

function betaContinued(a: number, b: number, x: number): number {
  const maxIterations = 500;
  const epsilon = 1e-15;
  const floor = Number.MIN_VALUE / epsilon;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < floor) d = floor;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + aa / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < floor) d = floor;
    c = 1 + aa / c;
    if (Math.abs(c) < floor) c = floor;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

/** Inverse of a strictly increasing CDF on [0, ∞) by expanding bisection. */
export function invertIncreasing(
  cdf: (x: number) => number,
  target: number,
): number {
  if (target < 0 || target > 1) throw new Error("#NUM!");
  let low = 0;
  let high = 1;
  for (let i = 0; i < 400 && cdf(high) < target; i++) high *= 2;
  for (let i = 0; i < 200; i++) {
    const middle = (low + high) / 2;
    if (cdf(middle) < target) low = middle;
    else high = middle;
    if (high - low <= 1e-15 * Math.max(1, high)) break;
  }
  return (low + high) / 2;
}

/** Standard normal inverse CDF. Symmetric about 0.5 so lower-tail probabilities stay negative. */
export function normalInverse(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("#NUM!");
  if (p === 0.5) return 0;
  if (p < 0.5) return -invertIncreasing(normalCdf, 1 - p);
  return invertIncreasing(normalCdf, p);
}

/** Chi-squared PDF. */
export function chiSquaredPdf(x: number, degreesOfFreedom: number): number {
  if (x < 0) throw new Error("#NUM!");
  const half = degreesOfFreedom / 2;
  if (x === 0) return degreesOfFreedom === 2 ? 0.5 : 0;
  return (
    Math.exp(-x / 2 + (half - 1) * Math.log(x) - gammln(half) - half * Math.LN2)
  );
}

/** Chi-squared CDF. */
export function chiSquaredCdf(x: number, degreesOfFreedom: number): number {
  if (x < 0) throw new Error("#NUM!");
  if (x === 0) return 0;
  return gammaP(degreesOfFreedom / 2, x / 2);
}

/** Student t PDF. */
export function tPdf(x: number, degreesOfFreedom: number): number {
  const logCoefficient =
    gammln((degreesOfFreedom + 1) / 2) -
    gammln(degreesOfFreedom / 2) -
    0.5 * Math.log(degreesOfFreedom * Math.PI);
  return Math.exp(logCoefficient - ((degreesOfFreedom + 1) / 2) * Math.log(1 + (x * x) / degreesOfFreedom));
}

/** Student t CDF (both tails by symmetry). */
export function tCdf(x: number, degreesOfFreedom: number): number {
  const beta = betaI(degreesOfFreedom / 2, 0.5, degreesOfFreedom / (degreesOfFreedom + x * x));
  return x > 0 ? 1 - 0.5 * beta : 0.5 * beta;
}

/** F PDF. */
export function fPdf(x: number, d1: number, d2: number): number {
  if (x < 0) throw new Error("#NUM!");
  if (x === 0) return d1 === 2 ? 1 : 0;
  const logCoefficient =
    (d1 / 2) * Math.log(d1 / d2) +
    ((d1 / 2) - 1) * Math.log(x) -
    ((d1 + d2) / 2) * Math.log(1 + (d1 * x) / d2) -
    gammln(d1 / 2) -
    gammln(d2 / 2) +
    gammln((d1 + d2) / 2);
  return Math.exp(logCoefficient);
}

/** F CDF. */
export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  return betaI(d1 / 2, d2 / 2, (d1 * x) / (d1 * x + d2));
}

export interface NormalSummary {
  mean: number
  variance: number
  count: number
}

/** Mean/variance of a flat sample; empty samples raise #DIV/0!. */
export function sampleSummary(values: number[], population = false): NormalSummary {
  if (values.length === 0) throw new Error("#DIV/0!");
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const denominator = population ? values.length : values.length - 1;
  const variance =
    denominator === 0
      ? 0
      : values.reduce((total, value) => total + (value - mean) ** 2, 0) / denominator;
  return { mean, variance, count: values.length };
}
