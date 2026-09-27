import type {
  AvailableSection,
  Evidence,
  InsufficientDataReason,
  InsufficientDataSection,
  IntelligenceSection,
} from '../types/intelligence';

/**
 * Section primitives for Phase 4 derived intelligence.
 *
 * A Phase 4 section is either `available` (real data, with evidence) or
 * `insufficient_data` (an explicit reason, no value). There is deliberately no
 * third state: no section may present a placeholder that looks like a real
 * financial figure.
 *
 * Pure and deterministic — no storage, network, clock or AI access.
 */

/** Build an available section. Evidence is mandatory by construction. */
export function available<T>(data: T, evidence: Evidence, notes: readonly string[] = []): AvailableSection<T> {
  return { status: 'available', data, evidence, notes: [...notes] };
}

/** Build an insufficient-data section. A reason is mandatory by construction. */
export function unavailable<T>(
  reasons: readonly InsufficientDataReason[],
): InsufficientDataSection & { __t?: T } {
  return {
    status: 'insufficient_data',
    data: null,
    evidence: null,
    reasons: [...reasons],
  };
}

/** True when a section carries derived, evidence-backed data. */
export function isAvailable<T>(
  section: IntelligenceSection<T>,
): section is AvailableSection<T> {
  return section.status === 'available';
}

/**
 * True when the section is unavailable *and* cites the given code.
 * Lets callers distinguish "no accounts yet" from "no budgets yet".
 */
export function isUnavailableBecause<T>(
  section: IntelligenceSection<T>,
  code: InsufficientDataReason['code'],
): boolean {
  return section.status === 'insufficient_data' && section.reasons.some((reason) => reason.code === code);
}

/**
 * Add a partial-coverage note to an available section, or return it unchanged
 * when it is unavailable. Notes never inject or alter a financial value.
 */
export function withNote<T>(section: IntelligenceSection<T>, note: string): IntelligenceSection<T> {
  if (section.status !== 'available') return section;
  return { ...section, notes: [...section.notes, note] };
}

/**
 * Combine reasons, dropping duplicates by code while keeping first-seen order,
 * so a section never repeats the same explanation twice.
 */
export function mergeReasons(
  ...groups: readonly InsufficientDataReason[][]
): InsufficientDataReason[] {
  const seen = new Set<string>();
  const out: InsufficientDataReason[] = [];
  for (const group of groups) {
    for (const reason of group) {
      if (seen.has(reason.code)) continue;
      seen.add(reason.code);
      out.push(reason);
    }
  }
  return out;
}
