import { EXIDX } from './exercises.js'
import { dbLoadFor, isBellEx } from './dumbbells.js'

export const exerciseForConfig = (st, cfg) => ({ ...(EXIDX[cfg.id] || st?.customEx?.find(e => e.id === cfg.id)), ...cfg })

// Current identity is resolved before any historical load reader runs.
export function equipmentSnapshotFor(st, cfg) {
  const ex = exerciseForConfig(st, cfg)
  const profile = st.equipProfiles?.find(p => p.id === st.activeEquipId)
  const station = profile?.stations?.find(s => s.id === cfg.stationId && s.exerciseIds?.includes(cfg.id))
  const meaning = dbLoadFor(st, cfg)
  const loadConvention = isBellEx(ex)
    ? meaning === 'each' ? 'db-per-hand' : meaning === 'total' ? 'db-total' : null
    : cfg.loadConvention || station?.loadConvention || (ex.eq === 'barbell' ? 'barbell-total' : null)
  return { stationId: station?.id || null,
    ...(station ? { label: station.label, ...(station.manufacturer ? { manufacturer: station.manufacturer } : {}), ...(station.model ? { model: station.model } : {}) } : {}),
    loadConvention, unit: loadConvention === 'machine-setting' ? null : st.unit || null, status: station ? 'exact' : 'unknown' }
}

export const isSettingLoad = entry => (entry?.equipmentSnapshot?.loadConvention ?? entry?.target?.loadConvention ?? entry?.loadConvention) === 'machine-setting'

export const uncertainImportedLoad = entry => entry?.sets?.some(s => s.sourceLoad) && entry?.equipmentSnapshot?.status !== 'exact'

/** Keep the old policies and legacy unknown loads, but never cross an explicit identity boundary. */
export function historyForLoad(st, cfg) {
  const current = cfg.equipmentSnapshot || equipmentSnapshotFor(st, cfg)
  const scoped = !!(cfg.stationId || cfg.loadConvention || current.stationId)
  let rejected = false
  const workouts = (st.workouts || []).map(w => ({ ...w, entries: (w.entries || []).filter(e => {
    if (e.id !== cfg.id) return true
    const prior = e.equipmentSnapshot
    const uncertainImport = uncertainImportedLoad(e)
    const stationChanged = (cfg.stationId || prior?.stationId) && (!current.stationId || current.stationId !== prior?.stationId)
    // Explicit each/total dumbbells still use the existing, deliberate historyAs conversion.
    const dbConversion = ['db-per-hand', 'db-total'].includes(current.loadConvention)
      && ['db-per-hand', 'db-total'].includes(prior?.loadConvention)
    const conventionChanged = prior?.loadConvention && current.loadConvention !== prior.loadConvention && !dbConversion
    const missingConvention = scoped && current.loadConvention && !prior?.loadConvention
    const machineUnknown = ['machine-total', 'machine-setting', 'plate-per-side'].includes(prior?.loadConvention) && (!prior.stationId || prior.status !== 'exact')
    const unitChanged = prior?.loadConvention && prior.loadConvention !== 'machine-setting' && (!['kg', 'lb'].includes(prior.unit) || prior.unit !== current.unit)
    const variantChanged = (cfg.variant ?? null) !== (e.target?.variant ?? null)
    const keep = !(uncertainImport || stationChanged || conventionChanged || missingConvention || machineUnknown || unitChanged || variantChanged)
    if (!keep) rejected = true
    return keep
  }) }))
  // These older cache entries are exercise-wide and cannot establish a station or convention.
  const exWeights = scoped || rejected ? { ...st.exWeights, [cfg.id]: undefined } : st.exWeights
  return { ...st, workouts, exWeights }
}
