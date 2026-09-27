import type {
  Evidence,
  InsufficientDataCode,
  InsufficientDataReason,
  SourceCollection,
  SourceRef,
} from '../types/intelligence';

/**
 * Evidence primitives for Phase 4 derived intelligence.
 *
 * Pure, deterministic, dependency-free helpers. Nothing in this module reads
 * storage, the network, the clock implicitly, or any AI provider — the caller
 * injects the timestamp so the same inputs always produce identical output.
 *
 * Phase 4A rule: no derived claim ships without evidence.
 */

/**
 * Rule version stamped on every Phase 4B evidence record.
 * Bump this whenever a threshold or rule body changes, so a stored claim can
 * always be reproduced from the rule version that produced it.
 */
export const EVIDENCE_RULE_VERSION = '4b.1';

/** Period key used for full-history (non-windowed) claims. */
export const ALL_PERIOD_KEY = 'all';

/** Deterministic `YYYY-MM` period key from an injected date. */
export function periodKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Build a source pointer. Kept in one place so collection names never drift. */
export function sourceRef(collection: SourceCollection, id: string): SourceRef {
  return { collection, id };
}

/**
 * Collapse duplicate and empty pointers while preserving first-seen order.
 * Evidence must stay reproducible, so ordering is deterministic.
 */
export function dedupeSourceRefs(refs: readonly SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const ref of refs) {
    if (!ref || typeof ref.id !== 'string' || ref.id.length === 0) continue;
    const key = `${ref.collection}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/** Keep monetary/numeric metrics free of non-finite values. */
function finiteMetrics(metrics: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out;
}

export interface EvidenceInput {
  ruleId: string;
  periodKey: string;
  computedAt: string;
  metrics?: Record<string, number>;
  thresholds?: Record<string, number>;
  sourceRefs?: readonly SourceRef[];
  ruleVersion?: string;
}

/**
 * Assemble one evidence record.
 *
 * Every Phase 4 claim goes through this function, which is why evidence can be
 * trusted to be complete: metrics, thresholds, sources and the rule version are
 * all mandatory parts of the same object.
 */
export function buildEvidence(input: EvidenceInput): Evidence {
  return {
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion ?? EVIDENCE_RULE_VERSION,
    periodKey: input.periodKey,
    metrics: finiteMetrics(input.metrics ?? {}),
    thresholds: finiteMetrics(input.thresholds ?? {}),
    sourceRefs: dedupeSourceRefs(input.sourceRefs ?? []),
    computedAt: input.computedAt,
  };
}

/**
 * Build an insufficient-data reason.
 * `missing` names the collections that would make the section derivable, which
 * is what lets the UI explain *why* nothing is shown instead of showing zeros.
 */
export function insufficient(
  code: InsufficientDataCode,
  message: string,
  missing: readonly SourceCollection[],
): InsufficientDataReason {
  return { code, message, missing: [...missing] };
}

/** Count source pointers per collection — useful in evidence metrics. */
export function countByCollection(refs: readonly SourceRef[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ref of dedupeSourceRefs(refs)) {
    counts[`sources.${ref.collection}`] = (counts[`sources.${ref.collection}`] ?? 0) + 1;
  }
  return counts;
}

/** Percentage helper: 0-100 with one decimal place, 0 when the total is 0. */
export function sharePercent(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}
