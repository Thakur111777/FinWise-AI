import { Outlet } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { useFinancialData } from '../../features/dashboard/useFinancialData';

export function AppShell() {
  const { lastError, clearLastError } = useFinancialData();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <MobileNav />
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          {lastError !== null && (
            <div
              role="alert"
              className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
            >
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{lastError}</span>
              </span>
              <button
                type="button"
                onClick={clearLastError}
                aria-label="Dismiss error"
                className="rounded-lg p-1 text-rose-700 hover:bg-rose-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
