import { Card } from '../components/ui/Card';

export function PrivacyCenterPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Privacy Center</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">How your financial data is protected</h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Data governance</h2>
          <p className="mt-3 text-sm text-slate-600">The architecture is prepared for secure storage, consent controls, and role-based access.</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">AI boundaries</h2>
          <p className="mt-3 text-sm text-slate-600">Financial calculations remain deterministic and the AI layer explains, but does not invent values.</p>
        </Card>
      </div>
    </div>
  );
}
