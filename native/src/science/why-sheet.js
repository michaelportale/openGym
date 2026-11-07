import { RULES } from './rules.js'

const PLAIN_LABELS = new Set(['Convention', 'Definition'])

/**
 * What the Why-this sheet shows for a payload from whyThis().
 * A Convention or Definition source is also the plain label. A citation is not.
 */
export function whySheetModel(payload) {
  if (!payload || typeof payload.reason !== 'string' || typeof payload.source !== 'string') {
    throw new Error('Why this sheet needs a whyThis() payload')
  }
  const rule = typeof payload.ruleId === 'string' ? RULES[payload.ruleId] : undefined
  const label = rule && PLAIN_LABELS.has(rule.source) ? rule.source : null
  return { ruleId: payload.ruleId, reason: payload.reason, source: payload.source, label }
}
