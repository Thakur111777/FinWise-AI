import { getSupabaseClient } from '../supabase/client';
import { createSupabaseIntelligenceRepository } from '../supabase/supabaseIntelligenceRepository';
import { LocalStorageIntelligenceRepository } from './localStorageIntelligenceRepository';
import type { FinancialIntelligenceRepository } from './intelligenceRepository';

/**
 * Phase 4B wiring: build the intelligence persistence boundary for the Digital
 * Twin from the same browser-safe client and verified session identity the
 * Financial Data store resolves.
 *
 * The caller (`features/intelligence/financialIntelligenceContext.tsx`) passes
 * the session user resolved by the auth layer — a UI-supplied id is never
 * trusted for ownership, and RLS stays the authoritative check on every
 * statement. `FinancialRepository` (Phase 3) is untouched: the intelligence
 * boundary is this separate, additive interface (Phase 4A §7).
 *
 * Selection mirrors the Phase 3B rule (one source of truth):
 *   * Supabase configured + authenticated user -> SupabaseIntelligenceRepository.
 *   * Otherwise (unconfigured environment, or no session) ->
 *     LocalStorageIntelligenceRepository fallback. Callers additionally guard
 *     the configured-but-signed-out case so local storage is never read behind
 *     an authenticated user's back.
 */
export function createFinancialIntelligenceRepository(
  user: { id: string } | null,
): FinancialIntelligenceRepository {
  const supabaseClient = getSupabaseClient();
  if (supabaseClient === null || user === null) {
    return new LocalStorageIntelligenceRepository();
  }
  return (
    createSupabaseIntelligenceRepository(supabaseClient, {
      getUserId: () => Promise.resolve(user.id),
    }) ?? new LocalStorageIntelligenceRepository()
  );
}
