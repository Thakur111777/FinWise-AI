/**
 * Result type used by the pure Financial Core services.
 *
 * Services never throw for expected validation failures — they return a
 * discriminated union the provider/UI can render without try/catch noise.
 */
export type FinancialResult<T> = { ok: true; value: T } | { ok: false; error: FinancialServiceError };

export interface FinancialServiceError {
  code: string;
  message: string;
  field?: string;
}

export function serviceOk<T>(value: T): FinancialResult<T> {
  return { ok: true, value };
}

export function serviceFail<T = never>(error: FinancialServiceError): FinancialResult<T> {
  return { ok: false, error };
}