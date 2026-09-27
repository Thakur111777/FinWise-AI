import { useState } from 'react';
import { LogOut, Save } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button, Field, Select, TextInput, ToggleCheckbox } from '../components/ui/forms';
import { useAuth } from '../features/auth/useAuth';
import { useFinancialData } from '../features/dashboard/useFinancialData';
import { SUPPORTED_CURRENCIES } from '../config/currencies';
import { isValidPayFrequency, type ProfileInput } from '../services/financial/profileService';
import type { CurrencyCode, FinancialPreferences, PayFrequency } from '../types/financial';

const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((currency) => ({
  value: currency.code,
  label: `${currency.symbol} ${currency.code} — ${currency.name}`,
}));

const PAY_FREQUENCY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Not set' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'irregular', label: 'Irregular' },
  { value: 'other', label: 'Other' },
];

const LOCALE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'ja-JP', label: 'Japanese (Japan)' },
];

export function SettingsPage() {
  const financial = useFinancialData();
  const { actions } = financial;
  const profile = financial.profile;
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (signOutFailure) {
      // A failed sign-out must never become an unhandled rejection: the
      // session is still active, so say so instead of pretending it worked.
      setSignOutError(
        signOutFailure instanceof Error ? signOutFailure.message : 'Could not sign out. Please try again.',
      );
    } finally {
      setSigningOut(false);
    }
  };

  const [name, setName] = useState(profile?.name ?? '');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(profile?.primaryCurrency ?? 'INR');
  const [locale, setLocale] = useState(profile?.locale ?? 'en-IN');
  const [payFrequency, setPayFrequency] = useState<string>(profile?.payFrequency ?? '');
  const [monthlyExpectation, setMonthlyExpectation] = useState(
    profile?.monthlyIncomeExpectation == null ? '' : String(profile?.monthlyIncomeExpectation ?? ''),
  );
  const [usePrimaryCurrency, setUsePrimaryCurrency] = useState(profile?.financialPreferences?.usePrimaryCurrency ?? true);
  const [riskTolerance, setRiskTolerance] = useState<string>(profile?.financialPreferences?.riskTolerance ?? 'balanced');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    const monthlyValue = monthlyExpectation === '' ? null : Number(monthlyExpectation);
    const preferences: FinancialPreferences = {
      usePrimaryCurrency,
      riskTolerance:
        riskTolerance === 'conservative' || riskTolerance === 'balanced' || riskTolerance === 'aggressive'
          ? riskTolerance
          : undefined,
    };
    try {
      const input: ProfileInput = {
        name,
        email: email || undefined,
        primaryCurrency: currency,
        locale,
        payFrequency: (isValidPayFrequency(payFrequency) ? payFrequency : '') as PayFrequency | '',
        monthlyIncomeExpectation: Number.isNaN(monthlyValue ?? 0) ? null : monthlyValue,
        financialPreferences: preferences,
      };
      await actions.saveProfile(input);
      setSuccess(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not save your profile.');
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{profile ? 'Your financial profile' : 'Set up your financial profile'}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          {profile
            ? 'Everything below feeds the Financial Core. Categories and accounts were seeded from your primary currency.'
            : 'Choose your primary currency first — it is the anchor every account, transaction, and dashboard figure uses. Default categories are created automatically.'}
        </p>
      </header>

      <Card>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Full name" htmlFor="profile-name">
            <TextInput id="profile-name" value={name} onChange={setName} placeholder="e.g. Aditi Sharma" autoComplete="name" />
          </Field>
          <Field
            label="Email (optional)"
            htmlFor="profile-email"
            hint={user ? 'Managed by your FinWise sign-in (Supabase Auth) — the app never stores your password.' : undefined}
          >
            <TextInput
              id="profile-email"
              value={email}
              onChange={setEmail}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              disabled={user !== null}
            />
          </Field>
          <Field label="Primary currency" htmlFor="profile-currency" hint="ISO currency code — never a bare symbol. Used across every format.">
            <Select value={currency} onChange={(value: CurrencyCode) => setCurrency(value)} options={CURRENCY_OPTIONS} />
          </Field>
          <Field label="Locale (number & date formatting)" htmlFor="profile-locale">
            <Select value={locale} onChange={setLocale} options={LOCALE_OPTIONS} />
          </Field>
          <Field label="Pay frequency" htmlFor="profile-pay-frequency">
            <Select value={payFrequency} onChange={setPayFrequency} options={PAY_FREQUENCY_OPTIONS} />
          </Field>
          <Field label="Expected monthly income (optional)" htmlFor="profile-income" hint="Used for planning context only — never shown as real money.">
            <TextInput id="profile-income" value={monthlyExpectation} onChange={(value) => setMonthlyExpectation(value.replace(/[^\d.,-]/g, ''))} placeholder="0.00" autoComplete="off" />
          </Field>
        </div>
<div className="mt-5 border-t border-slate-200 pt-4">
          <h2 className="text-base font-semibold text-slate-900">Financial preferences</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <ToggleCheckbox
              label="Use my primary currency everywhere"
              description="Dashboard and transaction views present amounts in your primary currency code."
              checked={usePrimaryCurrency}
              onChange={setUsePrimaryCurrency}
            />
            <Field label="Risk tolerance (for future labs)" htmlFor="profile-risk">
              <Select
                value={riskTolerance}
                onChange={setRiskTolerance}
                options={[
                  { value: 'conservative', label: 'Conservative' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'aggressive', label: 'Growth-oriented' },
                ]}
              />
            </Field>
          </div>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm font-medium text-rose-700">{error}</p>
        ) : success ? (
          <p role="status" className="mt-4 text-sm font-medium text-teal-800">
            Profile saved. {profile === null ? 'Default income and expense categories were created. Next: add an account.' : ''}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={handleSave} disabled={!name.trim()}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save profile
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-slate-900">Data &amp; privacy</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
          {user ? (
            <>
              <li>
                • Your financial data is stored in the FinWise Supabase PostgreSQL project and protected by Row Level
                Security — only your signed-in account can read or change it.
              </li>
              <li>• Your sign-in email and password are managed by Supabase Auth; the app never sees or stores your password.</li>
            </>
          ) : (
            <li>• All financial data is stored locally in this browser (local mode) — it survives refreshes through the local repository.</li>
          )}
          <li>• No API keys live in frontend code, and no number shown on a dashboard is ever fabricated.</li>
        </ul>
        {user && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <Button variant="secondary" onClick={handleSignOut} disabled={signingOut}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
            {signOutError !== null && (
              <p role="alert" className="mt-2 text-sm font-medium text-rose-700">
                {signOutError}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
