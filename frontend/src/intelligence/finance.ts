import { fromMinorUnits, multiplyMoney, roundMoney, subtractMoney, sumMoney, toMinorUnits } from '../lib/money';
import type {
  Account,
  Budget,
  DashboardDataInput,
  DashboardMetrics,
  FutureProjection,
  Goal,
  GoalProgressInfo,
  MonthlyFlow,
  NetWorthBreakdown,
  RecurringTransaction,
  SafeToSpendBreakdown,
  SafeToSpendComponents,
  Transaction,
} from '../types/financial';

/**
 * Financial Intelligence Engine.
 *
 * All deterministic financial calculations for FinWise live here — the UI
 * never computes or hardcodes financial values. Phase 1 established the
 * engine contract; Phase 2 feeds it real user data from the Financial Core
 * store (profile + accounts + transactions + recurring transactions).
 * All math is quantized through integer minor units (src/lib/money).
 */

/** Number of essential-expense months reserved as an emergency buffer rule. */
export const EMERGENCY_BUFFER_MONTHS = 3;

/** Default projection horizon used by the Future Projection engine. */
export const PROJECTION_HORIZON_MONTHS = 12;

/**
 * Deterministic Safe-to-Spend rule (product contract):
 *
 *   income
 *   - upcoming essential expenses
 *   - committed bills
 *   - budget commitments
 *   - savings commitments
 *   - emergency buffer
 *   = Safe-to-Spend
 */
export function safeToSpend(components: SafeToSpendComponents): number {
  const available = subtractMoney(
    components.income,
    sumMoney([
      components.upcomingEssentialExpenses,
      components.committedBills,
      components.budgetCommitments,
      components.savingsCommitments,
      components.emergencyBuffer,
    ]),
  );

  return Math.max(0, roundMoney(available));
}

/** True when a YYYY-MM-DD date falls inside the current local month. */
function isInCurrentMonth(isoDate: string): boolean {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return isoDate.startsWith(current);
}

function currentMonthIncome(transactions: Transaction[]): number {
  return fromMinorUnits(
    transactions.reduce(
      (sum, transaction) =>
        transaction.type === 'income' && isInCurrentMonth(transaction.date)
          ? sum + toMinorUnits(transaction.amount)
          : sum,
      0,
    ),
  );
}

function currentMonthExpenses(transactions: Transaction[]): number {
  return fromMinorUnits(
    transactions.reduce(
      (sum, transaction) =>
        transaction.type === 'expense' && isInCurrentMonth(transaction.date)
          ? sum + toMinorUnits(transaction.amount)
          : sum,
      0,
    ),
  );
}

/** Projects recurring commitments onto a monthly amount. */
function monthlyCommittedBills(recurring: RecurringTransaction[]): number {
  return fromMinorUnits(
    recurring.reduce((sum, item) => {
      if (!item.isActive) return sum;
      const monthly =
        item.frequency === 'weekly'
          ? (toMinorUnits(item.amount) * 52) / 12
          : item.frequency === 'yearly'
            ? toMinorUnits(item.amount) / 12
            : toMinorUnits(item.amount);
      return sum + Math.round(monthly);
    }, 0),
  );
}

/** Projects budget limits onto a monthly amount. */
function monthlyBudgetCommitments(budgets: Budget[]): number {
  return fromMinorUnits(
    budgets.reduce((sum, budget) => {
      const monthly =
        budget.period === 'weekly'
          ? (toMinorUnits(budget.limit) * 52) / 12
          : budget.period === 'yearly'
            ? toMinorUnits(budget.limit) / 12
            : toMinorUnits(budget.limit);
      return sum + Math.round(monthly);
    }, 0),
  );
}

export function buildSafeToSpendBreakdown(input: DashboardDataInput): SafeToSpendBreakdown {
  const income = currentMonthIncome(input.transactions);
  const upcomingEssentialExpenses = currentMonthExpenses(input.transactions);
  const committedBills = monthlyCommittedBills(input.recurringTransactions);
  const budgetCommitments = monthlyBudgetCommitments(input.budgets);
  // Phase 2: savings commitments stay an explicit engine input; auto-save
  // rules arrive with the goals phase.
  const savingsCommitments = 0;
  const emergencyBuffer = multiplyMoney(upcomingEssentialExpenses, EMERGENCY_BUFFER_MONTHS);

  const components: SafeToSpendComponents = {
    income,
    upcomingEssentialExpenses,
    committedBills,
    budgetCommitments,
    savingsCommitments,
    emergencyBuffer,
  };

  return { ...components, safeToSpend: safeToSpend(components) };
}

/** Total balance across all accounts (archived included). */
export function totalAccountBalance(accounts: Account[]): number {
  return sumMoney(accounts.map((account) => account.currentBalance));
}

export function computeNetWorthBreakdown(accounts: Account[]): NetWorthBreakdown {
  let cashMinor = 0;
  let investmentsMinor = 0;
  let debtMinor = 0;

  for (const account of accounts) {
    const value = toMinorUnits(account.currentBalance);
    if (account.type === 'investment') {
      investmentsMinor += value;
    } else if (account.type === 'creditCard') {
      debtMinor += Math.abs(value);
    } else {
      cashMinor += value;
    }
  }

  const cash = fromMinorUnits(cashMinor);
  const investments = fromMinorUnits(investmentsMinor);
  const debt = fromMinorUnits(debtMinor);
  return { cash, investments, debt, netWorth: roundMoney(cash + investments - debt) };
}

export function computeMonthlyFlow(transactions: Transaction[]): MonthlyFlow {
  const income = currentMonthIncome(transactions);
  const expenses = currentMonthExpenses(transactions);
  const savingsRate =
    income > 0 ? Math.max(0, Math.min(100, Math.round(((income - expenses) / income) * 100))) : 0;

  return { income, expenses, savingsRate };
}

/** Months of cash on hand given current monthly expenses, or null when unknowable. */
export function bufferMonths(netWorth: NetWorthBreakdown | null, monthlyExpenses: number | null): number | null {
  if (!netWorth || monthlyExpenses === null || monthlyExpenses <= 0) return null;
  return Math.trunc((netWorth.cash / monthlyExpenses) * 10) / 10;
}

export function calculateFinancialHealthScore(args: {
  savingsRate: number | null;
  bufferMonths: number | null;
  debtToIncomeMonths: number | null;
}): number | null {
  if (args.savingsRate === null || args.bufferMonths === null || args.debtToIncomeMonths === null) {
    return null;
  }

  // 20% savings rate is treated as a healthy full-score level.
  const savingsScore = Math.min(100, (args.savingsRate / 20) * 100);
  // Six months of expenses in cash is treated as a strong buffer.
  const bufferScore = Math.min(100, (args.bufferMonths / 6) * 100);
  // Each month of income owed reduces the debt score.
  const debtScore = Math.max(0, 100 - args.debtToIncomeMonths * 20);

  const score = savingsScore * 0.4 + bufferScore * 0.3 + debtScore * 0.3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function projectionSummary(args: {
  monthlyFlow: MonthlyFlow | null;
  netWorth: NetWorthBreakdown | null;
}): FutureProjection {
  if (!args.monthlyFlow || !args.netWorth) {
    return { horizonMonths: PROJECTION_HORIZON_MONTHS, projectedNetWorth: null, confidence: null };
  }

  const monthlySurplus = Math.max(0, args.monthlyFlow.income - args.monthlyFlow.expenses);
  const projectedNetWorth = roundMoney(args.netWorth.netWorth + monthlySurplus * PROJECTION_HORIZON_MONTHS);
  const confidence =
    args.monthlyFlow.income > 0 && args.monthlyFlow.expenses <= args.monthlyFlow.income ? 0.86 : 0.55;

  return { horizonMonths: PROJECTION_HORIZON_MONTHS, projectedNetWorth, confidence };
}

export function goalProgress(goal: Goal): number {
  if (goal.targetAmount <= 0) return 0;
  return Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
}

export function aggregateGoalProgress(goals: Goal[]): GoalProgressInfo {
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  if (activeGoals.length === 0) return { aggregate: null, activeGoalCount: 0 };

  const progressTotal = activeGoals.reduce((sum, goal) => sum + goalProgress(goal), 0);
  return {
    aggregate: Math.round(progressTotal / activeGoals.length),
    activeGoalCount: activeGoals.length,
  };
}

export function computeDashboardMetrics(input: DashboardDataInput): DashboardMetrics {
  const hasData =
    input.accounts.length > 0 ||
    input.transactions.length > 0 ||
    input.budgets.length > 0 ||
    input.goals.length > 0 ||
    input.recurringTransactions.length > 0;

  const netWorth = input.accounts.length > 0 ? computeNetWorthBreakdown(input.accounts) : null;
  const flow = input.transactions.length > 0 ? computeMonthlyFlow(input.transactions) : null;
  const buffered = bufferMonths(netWorth, flow ? flow.expenses : null);
  const debtToIncomeMonths =
    netWorth && flow && flow.income > 0 ? Math.round((netWorth.debt / flow.income) * 100) / 100 : null;

  return {
    hasData,
    netWorth,
    monthly: flow,
    bufferMonths: buffered,
    safeToSpend: hasData ? buildSafeToSpendBreakdown(input) : null,
    financialHealthScore: calculateFinancialHealthScore({
      savingsRate: flow ? flow.savingsRate : null,
      bufferMonths: buffered,
      debtToIncomeMonths,
    }),
    futureProjection: projectionSummary({ monthlyFlow: flow, netWorth }),
    goalProgress: aggregateGoalProgress(input.goals),
  };
}

export function classifySpending(transactions: Transaction[]) {
  const totals = transactions.reduce(
    (acc, transaction) => {
      if (transaction.type === 'expense') {
        const key = transaction.categoryId ?? 'uncategorized';
        acc[key] = (acc[key] ?? 0) + transaction.amount;
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
}