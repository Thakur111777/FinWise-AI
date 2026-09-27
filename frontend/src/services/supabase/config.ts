/**
 * Client-safe Supabase configuration boundary (Phase 3A).
 *
 * Locked architecture:
 *
 *   React Frontend
 *     -> FinWise Backend / secure server boundary
 *     -> Supabase (Auth + PostgreSQL)
 *     -> Row Level Security
 *
 * This module is the ONLY place the frontend reads Supabase settings, and it
 * deliberately reads only two variables:
 *
 *   VITE_SUPABASE_URL        public project URL
 *   VITE_SUPABASE_ANON_KEY   public "anon" / publishable key
 *
 * Everything `VITE_*` reaches the browser bundle and is therefore public
 * knowledge. The following must NEVER be referenced here or anywhere else in
 * src/:
 *
 *   * the Supabase service-role key (it bypasses Row Level Security)
 *   * database passwords or connection strings
 *   * AI provider secret keys (Phase 4 wiring goes through the backend)
 *
 * Privileged work belongs behind the FinWise backend / secure server boundary.
 * As a defence in depth, {@link getSupabaseConfig} refuses a key that decodes
 * to the `service_role` role instead of quietly shipping it to the browser.
 */

/** The client-safe half of the Supabase configuration. */
export interface SupabaseClientConfig {
  url: string;
  anonKey: string;
}

/** Environment variable names the frontend is allowed to read. */
export const SUPABASE_URL_ENV_VAR = 'VITE_SUPABASE_URL';
export const SUPABASE_ANON_KEY_ENV_VAR = 'VITE_SUPABASE_ANON_KEY';

/** Hard stop message used when a privileged key is detected in frontend env. */
const PRIVILEGED_KEY_MESSAGE =
  'Refusing to configure Supabase: the provided key has the "service_role" role. ' +
  'Service-role keys bypass Row Level Security and must never be used in frontend code. ' +
  'Set VITE_SUPABASE_ANON_KEY to the project anon/publishable key and keep the service-role key on the FinWise backend.';

/** Read a trimmed, non-empty string from the Vite client environment. */
function readEnvValue(key: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const raw = env?.[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Decode the `role` claim of a Supabase JWT without verifying it.
 *
 * Verification is pointless here: we are only trying to catch a catastrophic
 * misconfiguration, and the token is already readable by anyone who loads the
 * bundle. Non-JWT (publishable `sb_publishable_...`) keys return null.
 */
export function decodeKeyRole(token: string): string | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const atobFn = globalThis.atob;
  if (typeof atobFn !== 'function') return null;
  try {
    const normalized = segments[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (normalized.length % 4)) % 4;
    const decoded = atobFn(normalized + '='.repeat(padding));
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const role = (parsed as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the client-safe Supabase configuration.
 *
 * Returns `null` when Supabase is not configured yet, which is a normal state:
 * the app keeps running on the Phase 2 `LocalStorageRepository`.
 *
 * @throws Error when a `service_role` key is detected in frontend configuration.
 */
export function getSupabaseConfig(): SupabaseClientConfig | null {
  const url = readEnvValue(SUPABASE_URL_ENV_VAR);
  const anonKey = readEnvValue(SUPABASE_ANON_KEY_ENV_VAR);
  if (!url || !anonKey) return null;

  if (decodeKeyRole(anonKey) === 'service_role') {
    throw new Error(PRIVILEGED_KEY_MESSAGE);
  }

  return { url, anonKey };
}

/** True when both client-safe Supabase variables are present and safe. */
export function isSupabaseConfigured(): boolean {
  try {
    return getSupabaseConfig() !== null;
  } catch {
    // A privileged key in frontend env is a hard misconfiguration, never
    // "configured". The throw still surfaces through getSupabaseConfig().
    return false;
  }
}