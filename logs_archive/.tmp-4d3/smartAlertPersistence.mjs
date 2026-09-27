// src/services/financial/smartAlertPersistence.ts
var SMART_ALERT_FINGERPRINT_PREFIX = "smart-alert:v1:";
var INSIGHT_DEDUPE_READ_LIMIT = 500;
function smartAlertFingerprint(alert) {
  return `${SMART_ALERT_FINGERPRINT_PREFIX}${encodeURIComponent(alert.stableKey)}:${encodeURIComponent(alert.periodKey)}`;
}
function serializeAlert(alert, status = "active") {
  const persisted = {
    schemaVersion: 1,
    status,
    stableKey: alert.stableKey,
    ruleId: alert.ruleId,
    severity: alert.severity,
    periodKey: alert.periodKey,
    metrics: alert.metrics,
    // Keep the evidence payload intact; JSON is the existing text-column transport.
    evidence: alert.evidence
  };
  return JSON.stringify(persisted);
}
function persistedStatus(details) {
  try {
    const value = JSON.parse(details);
    if (value === null || typeof value !== "object") return null;
    const row = value;
    if (row.schemaVersion !== 1 || row.status !== "active" && row.status !== "dismissed") return null;
    return row.status;
  } catch {
    return null;
  }
}
function insightFor(alert) {
  return {
    type: "alert",
    title: alert.title,
    summary: alert.explanation,
    details: serializeAlert(alert),
    // Rule evaluation is deterministic and evidence-backed; this is not an AI confidence estimate.
    confidence: 1,
    category: smartAlertFingerprint(alert)
  };
}
function sameInsight(existing, next) {
  return existing.type === next.type && existing.title === next.title && existing.summary === next.summary && existing.details === next.details && existing.confidence === next.confidence && existing.category === next.category;
}
async function syncSmartAlerts(repository, section) {
  const result = {
    status: section.status === "available" ? "synced" : "insufficient_data",
    inserted: 0,
    updated: 0,
    unchanged: 0,
    dismissed: 0
  };
  if (section.status !== "available") return result;
  const existingRows = await repository.loadInsights(INSIGHT_DEDUPE_READ_LIMIT);
  const byFingerprint = /* @__PURE__ */ new Map();
  for (const row of existingRows) {
    if (row.type !== "alert" || !row.category?.startsWith(SMART_ALERT_FINGERPRINT_PREFIX)) continue;
    if (!byFingerprint.has(row.category)) byFingerprint.set(row.category, row);
  }
  const seen = /* @__PURE__ */ new Set();
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
    if (persistedStatus(existing.details) === "dismissed") {
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
async function dismissPersistedSmartAlert(repository, insight) {
  if (insight.type !== "alert" || !insight.category?.startsWith(SMART_ALERT_FINGERPRINT_PREFIX)) return false;
  if (persistedStatus(insight.details) === null) return false;
  const value = JSON.parse(insight.details);
  if (value.status === "dismissed") return true;
  await repository.updateInsight(insight.id, {
    details: JSON.stringify({ ...value, status: "dismissed" })
  });
  return true;
}
export {
  SMART_ALERT_FINGERPRINT_PREFIX,
  dismissPersistedSmartAlert,
  smartAlertFingerprint,
  syncSmartAlerts
};
