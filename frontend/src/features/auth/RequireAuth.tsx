import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

/**
 * Route protection for the authenticated FinWise application.
 *
 * Behaviour:
 *  - local mode (Supabase unconfigured): renders children directly, so the
 *    deliberate Phase 2 fallback keeps every page working without auth.
 *  - initialising: renders a neutral loading state and makes NO redirect
 *    decision — this is what prevents a refresh of a protected page from
 *    bouncing an authenticated user to /login before Supabase finishes
 *    restoring the session.
 *  - signed out: redirects to the existing authentication entry point
 *    (/login), remembering where the user came from.
 *  - authenticated: renders children.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, isLocalMode } = useAuth();
  const location = useLocation();

  if (isLocalMode) {
    return <>{children}</>;
  }

  if (status === 'initializing') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-10 w-10 animate-pulse items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-soft">
            F
          </div>
          <p className="text-sm font-medium text-slate-600">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}