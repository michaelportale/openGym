import { EXIDX } from './exercises.js'
import { hasExplicitMuscleMetadata, muscleWeightsOf } from './muscles.js'
import { dbLoadFor } from './dumbbells.js'

// Deliberately curated starting family; unfamiliar catalogue entries keep an unknown role.
export const TRAINING_ROLES = ['horizontal-press', 'vertical-press', 'horizontal-pull', 'vertical-pull', 'squat', 'hinge', 'chest-isolation', 'shoulder-isolation', 'elbow-flexion', 'elbow-extension', 'knee-flexion', 'knee-extension', 'calf-raise', 'core']
const curated = {
  '0047': ['horizontal-press', ['chest'], ['deltoids', 'triceps']],
  '0426': ['vertical-press', ['deltoids'], ['triceps']],
  '0241': ['elbow-extension', ['triceps'], []],
  '0251': ['horizontal-press', ['chest'], ['triceps', 'deltoids']],
  '2330': ['vertical-pull', ['upper-back'], ['biceps', 'deltoids']],
  '1323': ['horizontal-pull', ['upper-back'], ['biceps', 'forearm']],
  '0031': ['elbow-flexion', ['biceps'], ['forearm']],
  '0313': ['elbow-flexion', ['biceps'], ['forearm']],
  '0043': ['squat', ['quadriceps', 'gluteal'], ['adductors']],
  '0586': ['knee-flexion', ['hamstring'], []],
  '0605': ['calf-raise', ['calves'], []],
  '0025': ['horizontal-press', ['chest'], ['triceps', 'deltoids']],
  '0289': ['horizontal-press', ['chest'], ['triceps', 'deltoids']],
  '0314': ['horizontal-press', ['chest'], ['deltoids', 'triceps']],
  '0576': ['horizontal-press', ['chest'], ['triceps', 'deltoids']],
  '0577': ['horizontal-press', ['chest'], ['triceps', 'deltoids']],
  '0027': ['horizontal-pull', ['upper-back'], ['biceps', 'forearm']],
  '0861': ['horizontal-pull', ['upper-back'], ['biceps', 'forearm']],
  '0032': ['hinge', ['gluteal'], ['hamstring', 'lower-back']],
  '0085': ['hinge', ['hamstring', 'gluteal'], ['lower-back']],
  '3593': ['squat', ['quadriceps'], ['gluteal', 'adductors']],
  '0739': ['squat', ['quadriceps', 'gluteal'], []],
  '0201': ['elbow-extension', ['triceps'], []],
  '0294': ['elbow-flexion', ['biceps'], []],
  '0334': ['shoulder-isolation', ['deltoids'], ['trapezius']],
  '0585': ['knee-extension', ['quadriceps'], []],
  '0599': ['knee-flexion', ['hamstring'], []],
  '3018': ['calf-raise', ['calves'], []],
}
const unique = values => [...new Set(Array.isArray(values) ? values.filter(v => typeof v === 'string' && v) : [])]
export function trainingMetadataOf(ex) {
  if (ex?.trainingSnapshot) return structuredClone(ex.trainingSnapshot)
  const manual = ex?.trainingMetadata
  if (manual) {
    const primary = unique(manual.primary)
    return { role: TRAINING_ROLES.includes(manual.role) ? manual.role : null, primary, secondary: unique(manual.secondary).filter(m => !primary.includes(m)), status: TRAINING_ROLES.includes(manual.role) && primary.length ? 'manual' : 'unknown' }
  }
  const known = !ex?.custom && curated[ex?.id]
  if (known) return { role: known[0], primary: [...known[1]], secondary: [...known[2]], status: 'curated' }
  const weights = hasExplicitMuscleMetadata(ex) ? muscleWeightsOf(ex) : {}
  return { role: null, primary: Object.keys(weights).filter(m => weights[m] === 1), secondary: Object.keys(weights).filter(m => weights[m] > 0 && weights[m] < 1), status: 'unknown' }
}

// Capture at session creation, never by re-reading today's profile when finishing old work.
export function trainingSnapshotFor(st, cfg) {
  const ex = EXIDX[cfg.id] || cfg
  const trainingSnapshot = trainingMetadataOf({ ...ex, ...(st.trainingMetadata?.[cfg.id] ? { trainingMetadata: st.trainingMetadata[cfg.id] } : {}) })
  const profile = st.equipProfiles?.find(p => p.id === st.activeEquipId)
  const station = profile?.stations?.find(s => s.id === cfg.stationId && s.exerciseIds?.includes(cfg.id))
  const meaning = dbLoadFor(st, cfg)
  const loadConvention = cfg.loadConvention || station?.loadConvention || (ex.eq === 'barbell' ? 'barbell-total' : meaning === 'each' ? 'db-per-hand' : meaning === 'total' ? 'db-total' : null)
  const equipmentSnapshot = { stationId: station?.id || null,
    ...(station ? { label: station.label, ...(station.manufacturer ? { manufacturer: station.manufacturer } : {}), ...(station.model ? { model: station.model } : {}) } : {}),
    loadConvention, unit: loadConvention === 'machine-setting' ? null : st.unit || null, status: station ? 'exact' : 'unknown' }
  return { trainingSnapshot, equipmentSnapshot }
}
