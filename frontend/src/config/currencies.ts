import type { CurrencyCode } from '../types/financial';

/**
 * Central currency configuration.
 *
 * Every currency in the Financial Core is identified by its ISO-style
 * currency code. Symbols are presentation-only metadata — domain values and
 * storage always use `currencyCode`.
 */
export interface CurrencyDefinition {
  code: CurrencyCode;
  name: string;
  /** Presentation symbol, e.g. "₹" for INR. Never used as an identifier. */
  symbol: string;
  /** Intl locale typically associated with the currency. */
  locale: string;
}

export const SUPPORTED_CURRENCIES: readonly CurrencyDefinition[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', locale: 'en-IN' },
  { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
  { code: 'EUR', name: 'Euro', symbol: '€', locale: 'en-IE' },
  { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', locale: 'ja-JP' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', locale: 'en-CA' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', locale: 'en-AU' },
];

export const DEFAULT_CURRENCY: CurrencyCode = 'INR';
export const DEFAULT_LOCALE: string = 'en-IN';

const CURRENCY_BY_CODE = new Map<CurrencyCode, CurrencyDefinition>(
  SUPPORTED_CURRENCIES.map((currency) => [currency.code, currency]),
);

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return CURRENCY_BY_CODE.has(value as CurrencyCode);
}

export function getCurrencyDefinition(code: CurrencyCode): CurrencyDefinition {
  const definition = CURRENCY_BY_CODE.get(code);
  if (!definition) {
    throw new Error(`Unsupported currency code "${code}".`);
  }
  return definition;
}

export function currencySymbol(code: CurrencyCode): string {
  return getCurrencyDefinition(code).symbol;
}