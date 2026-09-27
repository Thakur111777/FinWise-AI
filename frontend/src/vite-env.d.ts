/// <reference types="vite/client" />

/**
 * Typed, client-safe Vite environment variables (Phase 3A).
 *
 * Only public values may be declared here. Anything declared `VITE_*` is
 * inlined into the browser bundle, so no secret may ever be added to this file.
 *
 * Supabase service-role keys, database credentials, and AI provider secrets
 * belong to the FinWise backend / secure server boundary — never to frontend
 * configuration.
 */
interface ImportMetaEnv {
  /** Public Supabase project URL, e.g. https://<project-ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Public Supabase anon/publishable key. RLS applies to every request. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}