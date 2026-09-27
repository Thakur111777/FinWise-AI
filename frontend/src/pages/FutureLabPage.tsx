import { Card } from '../components/ui/Card';

export function FutureLabPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Future Lab</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Decision space for tomorrow</h1>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Financial Time Machine</h2>
          <p className="mt-3 text-sm text-slate-600">Explore your past, present, and projected future with scenario-based continuity.</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Life Event Lab</h2>
          <p className="mt-3 text-sm text-slate-600">Model events like buying a car, starting a family, moving, or changing jobs.</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">What-If Simulator</h2>
          <p className="mt-3 text-sm text-slate-600">Try different salary, spending, and investment scenarios without committing to a decision.</p>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-slate-900">Decision Mode</h2>
          <p className="mt-3 text-sm text-slate-600">Ask: “Can I afford this?” and review affordability, trade-offs, and reasoning.</p>
        </Card>
      </div>
    </div>
  );
}
