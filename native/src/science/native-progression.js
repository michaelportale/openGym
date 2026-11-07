import { history, progression } from '../shared/training.js'
import { whyThis } from './rules.js'

// PRD default for reps when nobody has named a policy. Explicit prog values still win.
export const NATIVE_REP_POLICY = 'double'

export function nativeRepPolicy(cfg, routine) {
  const mode = history.modeOf(cfg || {})
  if (cfg?.prog || routine?.prog || mode !== 'reps') return progression.policyFor(cfg, routine, mode)
  return NATIVE_REP_POLICY
}

/** Shared nextPrescription, with the native reps default standing in for an unnamed policy. */
export function nativePrescription(S, cfg, routine) {
  if (history.modeOf(cfg || {}) === 'reps' && !cfg?.prog && !routine?.prog) {
    return progression.nextPrescription(S, cfg, { ...(routine || {}), prog: NATIVE_REP_POLICY })
  }
  return progression.nextPrescription(S, cfg, routine)
}

export function nativeProgressionWhy() {
  return whyThis('double-progression')
}
