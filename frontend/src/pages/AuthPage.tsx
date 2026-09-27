import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';

/**
 * Authentication entry point, wired to Supabase Auth in Phase 3B.
 *
 * The existing screen design is reused; what changed is that the form now
 * performs a real sign-in/sign-up through the centralised AuthProvider.
 * Passwords go only to Supabase Auth — never to the app, the database, or
 * any custom store.
 */
export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { status, isLocalMode, signInWithPassword, signUpWithPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Where RequireAuth sent us from (e.g. /transactions), so the user lands
  // back on the page they wanted after signing in.
  const redirectTarget = (location.state as { from?: string } | null)?.from ?? '/overview';

  const isLogin = mode === 'login';
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Signed-in users never see the forms again. This only triggers once the
  // session is known, never while it is still restoring (no redirect loops).
  if (!isLocalMode && status === 'authenticated') {
    return <Navigate to={redirectTarget} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (isLogin) {
        await signInWithPassword(email.trim(), password);
        navigate(redirectTarget, { replace: true });
        return;
      }
      const outcome = await signUpWithPassword(email.trim(), password, fullName.trim() || undefined);
      if (outcome.needsEmailConfirmation) {
        // Supabase Auth created the user (and the profile bootstrap trigger
        // has run); a session is only issued after the email is confirmed.
        setNotice('Almost there — confirm your email address (check your inbox), then sign in.');
      } else {
        navigate(redirectTarget, { replace: true });
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Could not complete the request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const brand = (
    <div className="mb-8 flex items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-700 text-lg font-bold text-white">F</div>
      <div>
        <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">FINWISE</p>
        <p className="text-lg font-semibold text-slate-900">AI</p>
      </div>
    </div>
  );

  if (isLocalMode) {
    // Supabase is not configured in this environment: the app deliberately
    // runs Phase 2 local mode, so authentication is honestly unavailable.
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
          {brand}
          <h1 className="text-3xl font-semibold text-slate-950">{isLogin ? 'Sign in' : 'Create your account'}</h1>
          <p className="mt-2 text-sm text-slate-600">
            Authentication is unavailable because Supabase is not configured in this environment. The app continues
            to run with local persistence and no account is required.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 hover:bg-slate-100"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-soft">
        {brand}

        <h1 className="text-3xl font-semibold text-slate-950">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isLogin ? 'Sign in to continue your financial story.' : 'Set up a secure plan for your money.'}
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {!isLogin && (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Full name</span>
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none ring-0 focus:border-teal-600"
                placeholder="Alex Morgan"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                disabled={submitting}
              />
            </label>
          )}

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none focus:border-teal-600"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              required
              minLength={isLogin ? undefined : 6}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-900 outline-none focus:border-teal-600"
              placeholder="••••••••"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm font-medium text-rose-700">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm font-medium text-teal-800">
              {notice}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-teal-700 px-4 py-3 font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          {isLogin ? 'Need an account?' : 'Already have an account?'}{' '}
          <Link to={isLogin ? '/signup' : '/login'} className="font-medium text-teal-700 hover:text-teal-800">
            {isLogin ? 'Create one' : 'Sign in'}
          </Link>
        </p>
      </div>
    </div>
  );
}
