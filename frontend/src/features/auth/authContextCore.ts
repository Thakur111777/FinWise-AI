import { createContext } from 'react';

/**
 * Shared context core for the authentication store.
 *
 * Split from the provider component so the react-refresh rule
 * (components-only exports) stays clean — the same pattern as
 * financialDataContextCore.ts. Pages consume the session through this
 * context and never call `supabase.auth` directly.
 */

/** How far initialisation of the Supabase Auth session has progressed. */
export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated';

/** The application-facing view of the authenticated user. */
export interface AuthUser {
  /** `auth.users.id` — the same id Postgres RLS scopes every row by. */
  id: string;
  /** Authoritative authentication email, owned by Supabase Auth. */
  email: string | null;
  /** Name captured at sign-up (`raw_user_meta_data ->> 'name'`). */
  displayName: string | null;
}

/** Result of a sign-up that did not immediately yield a session. */
export interface SignUpOutcome {
  /**
   * True when Supabase Auth created the user but requires email confirmation
   * before issuing a session. The profile bootstrap trigger has already run.
   */
  needsEmailConfirmation: boolean;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True until the persisted session has been restored (or ruled out). */
  isInitializing: boolean;
  /**
   * True when Supabase is not configured and the app deliberately runs the
   * Phase 2 local mode: no auth gate, LocalStorageRepository as the source of
   * truth. Route protection is only enforced outside local mode.
   */
  isLocalMode: boolean;
  signInWithPassword(email: string, password: string): Promise<void>;
  signUpWithPassword(email: string, password: string, fullName?: string): Promise<SignUpOutcome>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);