import { validateRir } from '../science/effort.js'
import { workoutModel } from '../shared/training.js'

// "Reps left" on a work set: optional, never read by any weight or reps logic. The choices stop at
// 5 ("5+"); the row is saved as `rir`, the field the shared effort helpers and the web read.
export const RIR_CHOICES = [0, 1, 2, 3, 4, 5]

export const rirChipText = n => (n === 5 ? '5+' : String(n))

export const rirChipLabel = n => (n === 5 ? '5 or more reps left' : `${n} ${n === 1 ? 'rep' : 'reps'} left`)

// A value set elsewhere (the web allows up to 10) shows on 5+.
export const isRirSelected = (current, choice) => (current == null ? false : choice === 5 ? current >= 5 : current === choice)

// Tapping the selected chip again clears it.
export const toggleRir = (current, picked) => (isRirSelected(current, picked) ? null : picked)

// Whether the sheet offers the row: a work set that is current or done, never a warm-up. A per-side
// set that is still current shows it for the side that finishes the set (the second), where it is
// saved; its first side logs no effort.
export function effortShown({ mode, warmup, perSide, side }) {
  if (warmup) return false
  if (mode === 'done') return true
  return mode === 'current' && (!perSide || side === 'R')
}

// The validator's sentence for a refused value in `values.rir`, else null. Only a bad number is
// refused: untouched (undefined) and cleared (null) are fine.
export function effortRefusal(values) {
  const v = validateRir(values?.rir)
  return v.ok ? null : v.error
}

// Whether the row holds a reps-left value, on the row or (per side, as the web writes it) a side.
export const rirLogged = row => row?.rir != null || row?.sides?.L?.rir != null || row?.sides?.R?.rir != null

// A per-side set carries its effort on both sides (the web derives the row's from the sides, as
// min(L, R), and drops a row-level one): the same number on each, so the derived value is the
// logged one. A number sets it; null removes it. Nothing else in the sides changes.
export function sidesWithRir(sides, rir) {
  const side = s => {
    const { rir: _old, ...rest } = s ?? {}
    return rir == null ? rest : { ...rest, rir }
  }
  return { L: side(sides.L), R: side(sides.R) }
}

// The hint under a chip: the selected one clears; 5+ over a value above 5 says what is logged.
export function rirChipHint(current, choice) {
  if (!isRirSelected(current, choice)) return 'Optional. Saved with this set.'
  return choice === 5 && current > 5 ? `Logged as ${current}. Tap to clear.` : 'Tap again to clear.'
}

// The `rir` field a call carries. `rir`: undefined = untouched (nothing written), null = cleared,
// else the chosen number. A clear removes a logged value (a null field deletes it from the row),
// and only when the caller passes `clear` (the keypad's Complete and Update do; null reaches them
// only from tapping a selected chip). A warm-up row never gets one.
export function rirFields(row, rir, { clear = false } = {}) {
  if (workoutModel.isWarmupRow(row) || rir === undefined) return { ok: true, fields: {} }
  const v = validateRir(rir)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.rir == null) return { ok: true, fields: clear && rirLogged(row) ? { rir: null } : {} }
  return { ok: true, fields: { rir: v.rir } }
}

// The refusal a write returns for such a value, in the shape the screen reads; null when fine.
export function effortFailure(values) {
  const message = effortRefusal(values)
  return message ? { ok: false, saved: false, error: { code: 'bad-rir', message } } : null
}

// The keypad's numbers with the sheet's reps-left choice: `rir` undefined (untouched) adds nothing.
export const withRir = (values, rir) => (rir === undefined ? values : { ...values, rir })
