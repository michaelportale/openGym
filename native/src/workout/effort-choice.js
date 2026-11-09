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

// The `rir` field a call carries. `rir`: undefined = untouched (nothing written), null = cleared,
// else the chosen number. A clear removes a logged value (a null field deletes it from the row),
// and only on an Update (`clear`): a Complete never writes over an earlier value. A warm-up row
// never gets one.
export function rirFields(row, rir, { clear = false } = {}) {
  if (workoutModel.isWarmupRow(row) || rir === undefined) return { ok: true, fields: {} }
  const v = validateRir(rir)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.rir == null) return { ok: true, fields: clear && row?.rir != null ? { rir: null } : {} }
  return { ok: true, fields: { rir: v.rir } }
}

// The refusal a write returns for such a value, in the shape the screen reads; null when fine.
export function effortFailure(values) {
  const message = effortRefusal(values)
  return message ? { ok: false, saved: false, error: { code: 'bad-rir', message } } : null
}

// The keypad's numbers with the sheet's reps-left choice: `rir` undefined (untouched) adds nothing.
export const withRir = (values, rir) => (rir === undefined ? values : { ...values, rir })
