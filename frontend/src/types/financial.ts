export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD';

export type UserRole = 'user' | 'admin';

/**
 * How often the user is paid. Used by the Financial Core for cash-flow
 * context and by the Financial Intelligence Engine for projections.
 */
export type PayFrequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'irregular' | 'other';

/** User-level financial preferences (Phase 2 is informational; later phases use them). */
export interface FinancialPreferences {
  /** When true, dashboards display amounts in the profile's primary currency. */
  usePrimaryCurrency?: boolean;
  /** Risk appetite (future labs). */
  riskTolerance?: 'conservative' | 'balanced' | 'aggressive';
  /** Day of the month a spending month starts (1-28, default 1). */
  monthStartsOn?: number;
}

/**
 * Typed user financial profile. `primaryCurrency` is always an ISO-style
 * currency code — never a bare symbol.
 */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  primaryCurrency: CurrencyCode;
  locale: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  role: UserRole;
  payFrequency?: PayFrequency;
  /** Optional expected monthly income used for planning (never a real number). */
  monthlyIncomeExpectation?: number | null;
  financialPreferences?: FinancialPreferences;
}

export type AccountType = 'cash' | 'checking' | 'savings' | 'creditCard' | 'investment' | 'other';

/**
 * Real account model of the Financial Core.
 *
 * `initialBalance` is the user-entered balance at account creation.
 * `currentBalance` is DERIVED from `initialBalance` plus every linked
 * transaction effect — it is recomputed by the transaction service so the
 * same balance can never be double-applied.
 */
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currencyCode: CurrencyCode;
  initialBalance: number;
  currentBalance: number;
  institutionName?: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CategoryType = 'income' | 'expense';

/**
 * Categorised transaction label. Default categories come from a central
 * configuration (src/config/categories) and are extensible by the user.
 */
export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  /** True when the category ships with the product defaults. */
  isDefault?: boolean;
  /** Hidden categories no longer appear in new-transaction pickers. */
  isHidden?: boolean;
  createdAt: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

/**
 * A single financial event. `amount` is a numeric monetary value (major
 * units) — never a formatted currency string. When `type` is `transfer`,
 * `accountId` is the source account and `toAccountId` the destination, so
 * both sides of a transfer are associated in one record.
 */
export interface Transaction {
  id: string;
  accountId: string;
  /** Transfer destination account (transfers only). */
  toAccountId?: string;
  type: TransactionType;
  amount: number;
  currencyCode: CurrencyCode;
  /** Required for income/expense transactions. */
  categoryId?: string;
  merchant?: string;
  description?: string;
  /** Date the transaction occurred (YYYY-MM-DD). */
  date: string;
  notes?: string;
  isRecurring: boolean;
  /** Set when this transaction was created from a recurring definition. */
  recurringTransactionId?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly';

/**
 * Deterministic recurring transaction definition. The Financial Core never
 * blindly creates duplicate transactions on render — upcoming occurrences are
 * computed by a pure recurrence engine and can later be materialised by a
 * backend scheduler.
 */
export interface RecurringTransaction {
  id: string;
  accountId: string;
  toAccountId?: string;
  type: TransactionType;
  amount: number;
  currencyCode: CurrencyCode;
  categoryId?: string;
  merchant?: string;
  description?: string;
  frequency: RecurrenceFrequency;
  startDate: string;
  /** Inclusive end date; when absent the schedule runs indefinitely. */
  endDate?: string;
  /** Next upcoming occurrence (YYYY-MM-DD), computed deterministically. */
  nextOccurrenceAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  currencyCode: CurrencyCode;
  limit: number;
  spent: number;
  period: 'monthly' | 'weekly' | 'yearly';
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface Goal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  currencyCode: CurrencyCode;
  targetDate?: string;
  categoryId?: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  createdAt: string;
}

export interface FinancialSnapshot {
  id: string;
  userId: string;
  capturedAt: string;
  netWorth: number;
  cashFlow: number;
  safeToSpend: number;
  financialHealthScore: number;
  income: number;
  expenses: number;
  savingsRate: number;
  debt: number;
  currencyCode: CurrencyCode;
}

export interface FinancialInsight {
  id: string;
  userId: string;
  type: 'alert' | 'optimization' | 'forecast' | 'risk' | 'milestone';
  title: string;
  summary: string;
  details: string;
  confidence: number;
  createdAt: string;
  category?: string;
}

export interface LifeEvent {
  id: string;
  userId: string;
  type: 'buy_car' | 'buy_house' | 'marriage' | 'baby' | 'college' | 'vacation' | 'move' | 'new_job' | 'job_loss' | 'start_business' | 'custom';
  title: string;
  date?: string;
  amount?: number;
  currencyCode?: CurrencyCode;
  notes?: string;
}

export interface Scenario {
  id: string;
  userId: string;
  name: string;
  description: string;
  assumptions: Record<string, number | string | boolean>;
  projectedNetWorth: number;
  confidence: number;
  createdAt: string;
}

export interface Decision {
  id: string;
  userId: string;
  question: string;
  answer: 'yes' | 'no' | 'maybe';
  affordabilityScore: number;
  explanation: string;
  createdAt: string;
}

export interface FinancialMemory {
  id: string;
  userId: string;
  theme: 'spending' | 'goal' | 'risk' | 'habit' | 'milestone';
  title: string;
  description: string;
  context: Record<string, unknown>;
  createdAt: string;
}

export interface AIContext {
  userId: string;
  profile: UserProfile;
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  financialSnapshot: FinancialSnapshot;
  lastInsights: FinancialInsight[];
  currencyCode: CurrencyCode;
  generatedAt: string;
}

export interface AppRouteConfig {
  key: string;
  label: string;
  path: string;
  description?: string;
}
/**
 * Payload the Financial Intelligence Engine consumes to derive dashboard
 * metrics: User Profile + Accounts + Transactions + Budgets + Goals +
 * Recurring Transactions -> Engine -> metrics -> Dashboard.
 */
export interface DashboardDataInput {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  recurringTransactions: RecurringTransaction[];
}

/** Input components of the deterministic Safe-to-Spend rule. */
export interface SafeToSpendComponents {
  income: number;
  upcomingEssentialExpenses: number;
  committedBills: number;
  budgetCommitments: number;
  savingsCommitments: number;
  emergencyBuffer: number;
}

/** Full Safe-to-Spend result including the computed value. */
export interface SafeToSpendBreakdown extends SafeToSpendComponents {
  safeToSpend: number;
}

export interface NetWorthBreakdown {
  cash: number;
  investments: number;
  debt: number;
  netWorth: number;
}

export interface MonthlyFlow {
  income: number;
  expenses: number;
  savingsRate: number;
}

export interface FutureProjection {
  horizonMonths: number;
  projectedNetWorth: number | null;
  confidence: number | null;
}

export interface GoalProgressInfo {
  /** Average percentage across active goals, or null when there are none. */
  aggregate: number | null;
  activeGoalCount: number;
}

/** Normalised result of the Financial Intelligence Engine for the dashboard. */
export interface DashboardMetrics {
  hasData: boolean;
  netWorth: NetWorthBreakdown | null;
  monthly: MonthlyFlow | null;
  bufferMonths: number | null;
  safeToSpend: SafeToSpendBreakdown | null;
  financialHealthScore: number | null;
  futureProjection: FutureProjection;
  goalProgress: GoalProgressInfo;
}
