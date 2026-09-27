// src/intelligence/section.ts
function available(data, evidence, notes = []) {
  return { status: "available", data, evidence, notes: [...notes] };
}
function unavailable(reasons) {
  return {
    status: "insufficient_data",
    data: null,
    evidence: null,
    reasons: [...reasons]
  };
}
function mergeReasons(...groups) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const group of groups) {
    for (const reason of group) {
      if (seen.has(reason.code)) continue;
      seen.add(reason.code);
      out.push(reason);
    }
  }
  return out;
}

// src/intelligence/evidence.ts
var EVIDENCE_RULE_VERSION = "4b.1";
var ALL_PERIOD_KEY = "all";
function dedupeSourceRefs(refs) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const ref of refs) {
    if (!ref || typeof ref.id !== "string" || ref.id.length === 0) continue;
    const key = `${ref.collection}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
function finiteMetrics(metrics) {
  const out = {};
  for (const [key, value] of Object.entries(metrics)) {
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out;
}
function buildEvidence(input) {
  return {
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion ?? EVIDENCE_RULE_VERSION,
    periodKey: input.periodKey,
    metrics: finiteMetrics(input.metrics ?? {}),
    thresholds: finiteMetrics(input.thresholds ?? {}),
    sourceRefs: dedupeSourceRefs(input.sourceRefs ?? []),
    computedAt: input.computedAt
  };
}

// src/features/alerts/smartAlertEngine.ts
var SMART_ALERT_RULE_VERSION = "4d.1";
var BUDGET_THRESHOLD_PERCENT = 100;
var MIN_STATE_POINTS = 2;
function categoryName(categories, id) {
  if (!id) return null;
  const match = categories.find((category) => category.id === id);
  return match ? match.name : null;
}
function round1(value) {
  return Math.round(value * 10) / 10;
}
function periodKeyOfIso(iso) {
  return iso.slice(0, 7);
}
function dedupe(alerts) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const alert of alerts) {
    if (seen.has(alert.stableKey)) continue;
    seen.add(alert.stableKey);
    out.push(alert);
  }
  return out;
}
function budgetAlerts(input) {
  if (input.budgets.status !== "available") return [];
  const out = [];
  for (const budget of input.budgets.data) {
    const percent = budget.utilizationPercent;
    if (percent === null || percent <= BUDGET_THRESHOLD_PERCENT) continue;
    const name = categoryName(input.categories, budget.categoryId) ?? budget.budgetId;
    out.push({
      stableKey: `budget_exceeded:${budget.budgetId}`,
      ruleId: "budget_exceeded",
      severity: "warning",
      title: `Budget exceeded: ${name}`,
      explanation: `Recorded spending of ${budget.spent} against a limit of ${budget.limit} is ${round1(percent)}% of the ${input.currencyCode} budget.`,
      periodKey: input.budgets.evidence.periodKey,
      metrics: {
        utilizationPercent: round1(percent),
        limit: budget.limit,
        spent: budget.spent
      },
      evidence: input.budgets.evidence
    });
  }
  return out;
}
function hiddenSpendingAlerts(input) {
  const out = [];
  if (input.smallCharges.status === "available") {
    for (const charge of input.smallCharges.data) {
      const name = categoryName(input.categories, charge.categoryId) ?? charge.categoryId ?? charge.merchantLabel;
      out.push({
        stableKey: `hidden_spending:small_charges:${charge.merchantLabel}:${charge.categoryId ?? "none"}`,
        ruleId: "hidden_spending",
        severity: "notice",
        title: `Frequent small charges: ${charge.merchantLabel}`,
        explanation: `${charge.transactionCount} recorded charges totalling ${charge.totalAmount} ${input.currencyCode} under ${name}.`,
        periodKey: input.smallCharges.evidence.periodKey,
        metrics: {
          transactionCount: charge.transactionCount,
          totalAmount: charge.totalAmount
        },
        evidence: input.smallCharges.evidence
      });
    }
  }
  if (input.cashGaps.status === "available") {
    for (const gap of input.cashGaps.data) {
      out.push({
        stableKey: `hidden_spending:cash_gap:${gap.accountTypeId}`,
        ruleId: "hidden_spending",
        severity: "notice",
        title: `No recorded cash spending: ${gap.accountTypeLabel}`,
        explanation: `Account type ${gap.accountTypeLabel} suggests cash spending, but no cash transactions are recorded for it.`,
        periodKey: input.cashGaps.evidence.periodKey,
        metrics: {
          suggestedCashAccounts: gap.suggestedCashAccountIds.length
        },
        evidence: input.cashGaps.evidence
      });
    }
  }
  return out;
}
function stateChangeAlerts(input) {
  if (input.financialState.status !== "available") return [];
  const points = input.financialState.data;
  if (points.length < MIN_STATE_POINTS) return [];
  const sorted = [...points].sort((a, b) => a.capturedAt < b.capturedAt ? -1 : a.capturedAt > b.capturedAt ? 1 : 0);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const netWorthChanged = first.netWorth !== null && last.netWorth !== null && first.netWorth !== last.netWorth;
  const scoreChanged = first.financialHealthScore !== null && last.financialHealthScore !== null && first.financialHealthScore !== last.financialHealthScore;
  const safeChanged = first.safeToSpend !== null && last.safeToSpend !== null && first.safeToSpend !== last.safeToSpend;
  if (!netWorthChanged && !scoreChanged && !safeChanged) return [];
  const metrics = { snapshotCount: points.length };
  const moved = [];
  if (netWorthChanged) {
    metrics.netWorthFrom = first.netWorth;
    metrics.netWorthTo = last.netWorth;
    moved.push("net worth");
  }
  if (scoreChanged) {
    metrics.healthScoreFrom = first.financialHealthScore;
    metrics.healthScoreTo = last.financialHealthScore;
    moved.push("health score");
  }
  if (safeChanged) {
    metrics.safeToSpendFrom = first.safeToSpend;
    metrics.safeToSpendTo = last.safeToSpend;
    moved.push("safe to spend");
  }
  return [
    {
      stableKey: "financial_state_change:all",
      ruleId: "financial_state_change",
      severity: "info",
      title: "Financial state changed",
      explanation: `Across ${points.length} recorded snapshots (${first.capturedAt.slice(0, 10)} to ${last.capturedAt.slice(0, 10)}), ${moved.join(" and ")} moved.`,
      periodKey: ALL_PERIOD_KEY,
      metrics,
      evidence: input.financialState.evidence
    }
  ];
}
function negativeNetFlowAlerts(input) {
  if (input.cashFlow.status !== "available") return [];
  const currentPeriod = periodKeyOfIso(input.computedAt);
  const incomeByPeriod = /* @__PURE__ */ new Map();
  const expensesByPeriod = /* @__PURE__ */ new Map();
  for (const point of input.cashFlow.data.income) {
    incomeByPeriod.set(point.period.key, (incomeByPeriod.get(point.period.key) ?? 0) + point.value);
  }
  for (const point of input.cashFlow.data.expenses) {
    expensesByPeriod.set(point.period.key, (expensesByPeriod.get(point.period.key) ?? 0) + point.value);
  }
  const out = [];
  for (const [periodKey, income] of incomeByPeriod) {
    if (periodKey >= currentPeriod) continue;
    const expenses = expensesByPeriod.get(periodKey);
    if (expenses === void 0 || expenses <= income) continue;
    out.push({
      stableKey: `negative_net_flow:${periodKey}`,
      ruleId: "negative_net_flow",
      severity: "warning",
      title: `Negative net flow: ${periodKey}`,
      explanation: `Recorded expenses of ${expenses} exceeded recorded income of ${income} by ${expenses - income} ${input.currencyCode} in ${periodKey}.`,
      periodKey,
      metrics: { income, expenses, netFlow: income - expenses },
      evidence: input.cashFlow.evidence
    });
  }
  return out;
}
function deriveSmartAlerts(input) {
  const sections = [input.budgets, input.smallCharges, input.cashGaps, input.financialState, input.cashFlow];
  const reasons = [];
  let hasAvailableInput = false;
  for (const section of sections) {
    if (section.status === "available") hasAvailableInput = true;
    else reasons.push(...section.reasons);
  }
  if (!hasAvailableInput) {
    return unavailable(mergeReasons(reasons));
  }
  const alerts = dedupe([
    ...budgetAlerts(input),
    ...hiddenSpendingAlerts(input),
    ...stateChangeAlerts(input),
    ...negativeNetFlowAlerts(input)
  ]).map((alert) => ({ ...alert }));
  const sourceRefs = sections.flatMap(
    (section) => section.status === "available" ? section.evidence.sourceRefs : []
  );
  const evidence = buildEvidence({
    ruleId: "alerts.smartAlertEngine",
    ruleVersion: SMART_ALERT_RULE_VERSION,
    periodKey: ALL_PERIOD_KEY,
    computedAt: input.computedAt,
    metrics: { alertCount: alerts.length },
    thresholds: { budgetUtilizationPercent: BUDGET_THRESHOLD_PERCENT, minimumStatePoints: MIN_STATE_POINTS },
    sourceRefs
  });
  return available(alerts, evidence);
}
export {
  SMART_ALERT_RULE_VERSION,
  deriveSmartAlerts
};
