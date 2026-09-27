import type { CurrencyCode } from '../types/financial';
import { getCurrencyDefinition } from '../config/currencies';

/**
 * Currency formatting — the ONLY place monetary values become strings.
 *
 * Domain values are plain numbers (major units). Presentation happens in
 * this utility so no component ever scatters its own Intl/format logic.
 */

const FRACTION_DIGITS: Record<CurrencyCode, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  CAD: 2,
  AUD: 2,
};

export function currencyFractionDigits(code: CurrencyCode): number {
  return FRACTION_DIGITS[code];
}

/**
 * Format a numeric monetary value in the given currency.
 * `locale` defaults to the currency's canonical locale.
 */
export function formatCurrency(value: number, currencyCode: CurrencyCode, locale?: string): string {
  const definition = getCurrencyDefinition(currencyCode);
  const resolvedLocale = locale && locale.length > 0 ? locale : definition.locale;
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: FRACTION_DIGITS[currencyCode],
      maximumFractionDigits: FRACTION_DIGITS[currencyCode],
    }).format(value);
  } catch {
    // A malformed locale must never crash the whole app — fall back to the
    // currency's canonical locale.
    return new Intl.NumberFormat(definition.locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: FRACTION_DIGITS[currencyCode],
      maximumFractionDigits: FRACTION_DIGITS[currencyCode],
    }).format(value);
  }
}

/** Signed display for cash-flow rows, e.g. "+₹1,234" / "-₹850". */
export function formatSignedCurrency(value: number, currencyCode: CurrencyCode, locale?: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatCurrency(Math.abs(value), currencyCode, locale)}`;
}