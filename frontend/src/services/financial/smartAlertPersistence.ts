import type { SmartAlert } from '../../features/alerts/smartAlertEngine';
import type { FinancialInsight } from '../../types/financial';
import type { IntelligenceSection } from '../../types/intelligence';
import type { FinancialIntelligenceRepository, NewFinancialInsight } from './intelligenceRepository';

/** Marker stored in the existing financial_insights.category text column. */
export const SMART_ALERT_FINGERPRINT_PREFIX = 'smart-alert:v1:';

/** Bounded read matches the existing repository's bounded-history convention. */
const INSIGHT_DEDUPE_READ_LIMIT = 500;

interface PersistedSmartAlert {
  schemaVersion: 1;
  status: 'active' | 'dismissed';
  stableKey: string;
  ruleId: SmartAlert['ruleId'];
  severity: SmartAlert['severity'];
  periodKey: string;
  metrics: Record<string, number>;
  evidence: SmartAlert['evidence'];
}

export interface SmartAlertSyncResult {
  status: 'synced' | 'insufficient_data';
  inserted: number;
  updated: number;
  unchanged: number;
  dismissed: number;
}

/** The fingerprint includes both the engine identity and the derived period. */
export function smartAlertFingerprint(alert: Pick<SmartAlert, 'stableKey' | 'periodKey'>): string {
  return `${SMART_ALERT_FINGERPRINT_PREFIX}${encodeURIComponent(alert.stableKey)}:${encodeURIComponent(alert.periodKey)}`;
}

function serializeAlert(alert: SmartAlert, status: PersistedSmartAlert['status'] = 'active'): string {
  const persisted: PersistedSmartAlert = {
    schemaVersion: 1,
    status,
    stableKey: alert.stableKey,
    ruleId: alert.ruleId,
    severity: alert.severity,
    periodKey: alert.periodKey,
    metrics: alert.metrics,
    // Keep the evidence payload intact; JSON is the existing text-column transport.
    evidence: alert.evidence,
  };
  return JSON.stringify(persisted);
}

function persistedStatus(details: string): PersistedSmartAlert['status'] | null {
  try {
    const value: unknown = JSON.parse(details);
    if (value === null || typeof value !== 'object') return null;
    const row = value as Partial<PersistedSmartAlert>;
    if (row.schemaVersion !== 1 || (row.status !== 'active' && row.status !== 'dismissed')) return null;
    return row.status;
  } catch {
    return null;
  }
}

function insightFor(alert: SmartAlert): NewFinancialInsight {
  return {
    type: 'alert',
    title: alert.title,
    summary: alert.explanation,
    details: serializeAlert(alert),
    // Rule evaluation is deterministic and evidence-backed; this is not an AI confidence estimate.
    confidence: 1,
    category: smartAlertFingerprint(alert),
  };
}

function sameInsight(existing: FinancialInsight, next: NewFinancialInsight): boolean {
  return existing.type === next.type &&
    existing.title === next.title &&
    existing.summary === next.summary &&
    existing.details === next.details &&
    existing.confidence === next.confidence &&
    existing.category === next.category;
}

/**
 * Upsert active engine output through the existing intelligence repository.
 * User ownership is resolved by that repository; this service accepts no user id.
 */
export async function syncSmartAlerts(
  repository: FinancialIntelligenceRepository,
  section: IntelligenceSection<SmartAlert[]>,
): Promise<SmartAlertSyncResult> {
  const result: SmartAlertSyncResult = {
    status: section.status === 'available' ? 'synced' : 'insufficient_data',
    inserted: 0,
    updated: 0,
    unchanged: 0,
    dismissed: 0,
  };
  if (section.status !== 'available') return result;

  const existingRows = await repository.loadInsights(INSIGHT_DEDUPE_READ_LIMIT);
  const byFingerprint = new Map<string, FinancialInsight>();
  for (const row of existingRows) {
    if (row.type !== 'alert' || !row.category?.startsWith(SMART_ALERT_FINGERPRINT_PREFIX)) continue;
    // loadInsights is newest-first; keep the newest row if earlier duplicates exist.
    if (!byFingerprint.has(row.category)) byFingerprint.set(row.category, row);
  }
  const seen = new Set<string>();

  for (const alert of section.data) {
    const fingerprint = smartAlertFingerprint(alert);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const next = insightFor(alert);
    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      await repository.saveInsight(next);
      result.inserted += 1;
      continue;
    }

    if (persistedStatus(existing.details) === 'dismissed') {
      result.dismissed += 1;
      continue;
    }
    if (sameInsight(existing, next)) {
      result.unchanged += 1;
      continue;
    }
    await repository.updateInsight(existing.id, next);
    result.updated += 1;
  }

  return result;
}

/** Record dismissal in the existing mutable details text field (no schema change). */
export async function dismissPersistedSmartAlert(
  repository: FinancialIntelligenceRepository,
  insight: FinancialInsight,
): Promise<boolean> {
  if (insight.type !== 'alert' || !insight.category?.startsWith(SMART_ALERT_FINGERPRINT_PREFIX)) return false;
  if (persistedStatus(insight.details) === null) return false;
  const value = JSON.parse(insight.details) as PersistedSmartAlert;
  if (value.status === 'dismissed') return true;
  await repository.updateInsight(insight.id, {
    details: JSON.stringify({ ...value, status: 'dismissed' }),
  });
  return true;
}
