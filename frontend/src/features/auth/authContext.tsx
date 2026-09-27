import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../services/supabase/client';
import { AuthContext, type AuthStatus, type AuthUser, type SignUpOutcome } from './authContextCore';

/**
 * Authentication provider — the single source of truth for the FinWise session.
 *
 * Data flow (Phase 3B):
 *
 *   Supabase Auth (session restore + auth state changes)
 *     -> this provider (initialising / authenticated / signed out)
 *     -> RequireAuth (route protection)
 *     -> FinancialDataProvider (swaps in the SupabaseRepository)
 *
 * Authentication concerns stay centralised here: no page, hook, or service
 * calls `supabase.auth` directly. The client is built from the public
 * anon/publishable key only, and every database statement it later issues is
 * additionally constrained by Row Level Security.
 *
 * Passwords are never stored, hashed, or transported anywhere except to
 * Supabase Auth's own endpoints — there is no custom password system.
 */

/** Map the raw Supabase Auth user onto the application-facing shape. */
function toAuthUser(user: User): AuthUser {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawName = metadata['name'];
  const displayName = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : null;
  return { id: user.id, email: user.email ?? null, displayName };
}

/**
 * Same authenticated identity, so token refreshes and repeated SIGNED_IN
 * events never cause needless re-renders of the whole app.
 */
function isSameUser(previous: AuthUser | null, next: AuthUser | null): boolean {
  if (previous === next) return true;
  if (previous === null || next === null) return false;
  return previous.id === next.id && previous.email === next.email && previous.displayName === next.displayName;
}

/** Translate Supabase Auth errors into honest, actionable messages. */
function describeAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'Incorrect email or password.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'This email has not been confirmed yet. Check your inbox for the confirmation link, then sign in.';
  }
  if (/user already registered/i.test(message)) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (/password should be at least/i.test(message)) {
    return 'That password is too short — use at least 6 characters.';
  }
  if (/rate limit/i.test(message)) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Memoised by the client factory; null only when Supabase is unconfigured.
  const client = getSupabaseClient();
  // When Supabase is unconfigured the app deliberately runs Phase 2 local
  // mode: nobody can ever be signed in, so the store starts (and stays)
  // unauthenticated — no effect-driven reset is needed.
  const [status, setStatus] = useState<AuthStatus>(client === null ? 'unauthenticated' : 'initializing');
  const [user, setUser] = useState<AuthUser | null>(null);

  const applySession = useCallback((session: Session | null) => {
    const nextUser = session?.user ? toAuthUser(session.user) : null;
    setUser((previous) => (isSameUser(previous, nextUser) ? previous : nextUser));
    setStatus(session?.user ? 'authenticated' : 'unauthenticated');
  }, []);

  useEffect(() => {
    if (client === null) {
      // Local mode: there is no auth system to initialise.
      return;
    }

    let isActive = true;

    // 1. Restore the persisted session after a page refresh. Routes wait for
    //    this before making any redirect decision.
    void client.auth.getSession().then(({ data }) => {
      if (isActive) applySession(data.session);
    });

    // 2. Subscribe to every later auth state change (sign-in, sign-out,
    //    token refresh, user switch). Only React state is touched inside the
    //    callback — calling further client methods here can deadlock
    //    supabase-js's internal lock.
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      isActive = false;
      void data.subscription.unsubscribe();
    };
  }, [client, applySession]);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<void> => {
      if (client === null) {
        throw new Error('Authentication is unavailable: Supabase is not configured in this environment.');
      }
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(describeAuthError(error.message));
      // Apply the returned session immediately (the SIGNED_IN event also
      // arrives) so route protection sees `authenticated` before navigation.
      if (data.session) applySession(data.session);
    },
    [client, applySession],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string, fullName?: string): Promise<SignUpOutcome> => {
      if (client === null) {
        throw new Error('Authentication is unavailable: Supabase is not configured in this environment.');
      }
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          // `name` is read by the Phase 3A handle_new_user() trigger to fill
          // the bootstrap profile (raw_user_meta_data ->> 'name').
          data: fullName ? { name: fullName } : undefined,
        },
      });
      if (error) throw new Error(describeAuthError(error.message));
      if (data.session) {
        applySession(data.session);
        return { needsEmailConfirmation: false };
      }
      // User created without a session: Supabase Auth requires email
      // confirmation first. Nobody is signed in yet.
      return { needsEmailConfirmation: true };
    },
    [client, applySession],
  );

  const signOut = useCallback(async (): Promise<void> => {
    if (client === null) return;
    const { error } = await client.auth.signOut();
    if (error) throw new Error(describeAuthError(error.message));
    // The SIGNED_OUT event also arrives; applying immediately keeps route
    // protection and the data store in sync without waiting for it.
    applySession(null);
  }, [client, applySession]);

  const value = useMemo(
    () => ({
      status,
      user,
      isAuthenticated: status === 'authenticated',
      isInitializing: status === 'initializing',
      isLocalMode: client === null,
      signInWithPassword,
      signUpWithPassword,
      signOut,
    }),
    [status, user, client, signInWithPassword, signUpWithPassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}