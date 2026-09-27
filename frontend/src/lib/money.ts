/**
 * Deterministic monetary math for the Financial Core.
 *
 * Precision strategy: amounts are stored as numeric major units (e.g. 850.00)
 * but all additive math is quantized through integer minor units so floating
 * point drift can never corrupt balances or metrics.
 */

/** Minor units per major unit for currencies with a 2-decimal subunit. */
const MINOR_UNITS = 100;

/** Quantize a major-unit value to the smallest representable minor unit. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * MINOR_UNITS) / MINOR_UNITS;
}

export function toMinorUnits(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * MINOR_UNITS);
}

export function fromMinorUnits(minor: number): number {
  return minor / MINOR_UNITS;
}

/** Exact integer sum of major-unit values via minor-unit math. */
export function sumMoney(values: readonly number[]): number {
  let minor = 0;
  for (const value of values) {
    minor += toMinorUnits(value);
  }
  return fromMinorUnits(minor);
}

/** Exact integer difference: `a - b`. */
export function subtractMoney(a: number, b: number): number {
  return fromMinorUnits(toMinorUnits(a) - toMinorUnits(b));
}

/** Exact integer product of a monetary value and a factor. */
export function multiplyMoney(value: number, factor: number): number {
  return fromMinorUnits(Math.round(toMinorUnits(value) * factor));
}