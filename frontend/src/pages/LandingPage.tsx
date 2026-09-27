import { ArrowRight, BrainCircuit, ShieldCheck, Sparkles, TrendingUp, Wallet2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '../components/ui/Card';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.12),_transparent_35%),linear-gradient(180deg,#f8fafc_0%,#eef6f5_100%)] px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-soft">
              F
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">FINWISE</p>
              <p className="text-base font-semibold">AI</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 md:flex">
            <a href="#product" className="text-sm text-slate-600 hover:text-slate-900">Product</a>
            <a href="#security" className="text-sm text-slate-600 hover:text-slate-900">Security</a>
            <a href="#insights" className="text-sm text-slate-600 hover:text-slate-900">Insights</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link to="/login" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400">
              Sign in
            </Link>
            <Link to="/signup" className="rounded-full bg-teal-700 px-4 py-2 text-sm font-medium text-white shadow-soft hover:bg-teal-800">
              Get started
            </Link>
          </div>
        </header>

        <section className="mt-16 grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-teal-800">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Financial intelligence layer
            </p>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
              Personal finance with a real financial digital twin.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-slate-600">
              Gain clarity over your finances, spend with confidence, plan for the future, and make informed financial decisions.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className="inline-flex items-center justify-center gap-2 rounded-full bg-teal-700 px-6 py-3 text-sm font-medium text-white shadow-soft hover:bg-teal-800">
                Start your financial story
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/overview" className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-medium text-slate-700 hover:border-slate-400">
                Explore dashboard
              </Link>
            </div>

            <dl className="mt-10 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">Financial Health</dt>
                <dd className="mt-2 text-2xl font-semibold text-slate-950">—</dd>
                <dd className="mt-1 text-xs text-slate-500">computed from your data</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">Safe to Spend</dt>
                <dd className="mt-2 text-2xl font-semibold text-slate-950">—</dd>
                <dd className="mt-1 text-xs text-slate-500">after onboarding</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">Projection</dt>
                <dd className="mt-2 text-2xl font-semibold text-slate-950">12 mo</dd>
                <dd className="mt-1 text-xs text-slate-500">rolling horizon</dd>
              </div>
            </dl>
          </div>
<Card className="p-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Your net worth</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">—</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                  Sample layout
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Personalised numbers appear here after you connect your accounts.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Financial Health Score</span>
                    <span className="font-medium text-slate-900">—</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-200" />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Safe to Spend</span>
                    <span className="font-medium text-slate-900">—</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-200" />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-slate-600">Goal Progress</span>
                    <span className="font-medium text-slate-900">—</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-200" />
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section id="product" className="mt-20 grid gap-4 md:grid-cols-3">
          <Card>
            <ShieldCheck className="h-8 w-8 text-teal-700" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Safe-to-spend intelligence</h2>
            <p className="mt-2 text-sm text-slate-600">Deterministic calculations keep spending recommendations grounded in your real cash flow and obligations.</p>
          </Card>
          <Card>
            <TrendingUp className="h-8 w-8 text-sky-600" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Future projections</h2>
            <p className="mt-2 text-sm text-slate-600">Understand your time machine, what-if scenarios, and the likely path of your financial future.</p>
          </Card>
          <Card>
            <Sparkles className="h-8 w-8 text-violet-600" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Explain every number</h2>
            <p className="mt-2 text-sm text-slate-600">Progressive disclosure keeps the experience helpful for beginners and useful for advanced users.</p>
          </Card>
        </section>

        <section id="security" className="mt-20 grid gap-4 md:grid-cols-2">
          <Card>
            <ShieldCheck className="h-8 w-8 text-teal-700" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Privacy-first architecture</h2>
            <p className="mt-2 text-sm text-slate-600">
              Financial values stay deterministic and protected. Secret keys never live in the frontend — provider calls are planned through a secure backend layer.
            </p>
          </Card>
          <Card>
            <Sparkles className="h-8 w-8 text-teal-700" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Consent-aware by design</h2>
            <p className="mt-2 text-sm text-slate-600">
              Your data is treated as sensitive financial context, with consent controls and role-based access planned into the architecture.
            </p>
          </Card>
        </section>

        <section id="insights" className="mt-20 grid gap-4 md:grid-cols-3">
          <Card>
            <Wallet2 className="h-8 w-8 text-sky-600" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Every number traceable</h2>
            <p className="mt-2 text-sm text-slate-600">
              Each figure on your dashboard is derived by the Financial Intelligence Engine from your real data — never hardcoded for display.
            </p>
          </Card>
          <Card>
            <TrendingUp className="h-8 w-8 text-teal-700" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">Progressive disclosure</h2>
            <p className="mt-2 text-sm text-slate-600">
              Start with a simple insight, then dig into the underlying calculations and reasoning whenever you want.
            </p>
          </Card>
          <Card>
            <BrainCircuit className="h-8 w-8 text-violet-600" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">AI explains, never invents</h2>
            <p className="mt-2 text-sm text-slate-600">
              The AI layer references engine outputs for reasoning and recommendations — it never fabricates financial values.
            </p>
          </Card>
        </section>
      </div>
    </div>
  );
}