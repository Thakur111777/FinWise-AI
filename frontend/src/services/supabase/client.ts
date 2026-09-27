import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';

/**
 * Lazy Supabase client factory (Phase 3A).
 *
 * The client is created on first use, never at module load, so:
 *   * the Phase 2 app keeps working unchanged when Supabase is unconfigured
 *   * importing this module can never throw because of missing env variables
 *
 * This client only ever holds the public anon/publishable key. Every query it
 * makes is filtered by the Row Level Security policies in
 * supabase/migrations/20260915090000_phase3a_initial_schema.sql.
 *
 * Phase 3B wires this client into the app: `AuthProvider` drives Supabase Auth
 * through it, and `FinancialDataProvider` uses it to build the
 * `SupabaseRepository` for authenticated users.
 */

let cachedClient: SupabaseClient | null | undefined;

/**
 * Return the shared Supabase client, or `null` when Supabase is not configured.
 *
 * @throws Error when a privileged (service_role) key is present in frontend env.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient !== undefined) return cachedClient;

  const config = getSupabaseConfig();
  if (config === null) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(config.url, config.anonKey, {
    auth: {
      // Real Supabase Auth session handling (no stubs, no fake users).
      // Session persistence is what lets a page refresh restore the session
      // before RequireAuth makes any redirect decision.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return cachedClient;
}

/**
 * Drop the memoised client. Intended for tests and for a future sign-out that
 * needs a clean client; it never leaks configuration.
 */
export function resetSupabaseClient(): void {
  cachedClient = undefined;
}