import { EXIDX } from './exercises.js'
import { trainingMetadataOf, TRAINING_ROLES } from './training-metadata.js'
import { hasCompletedWork, isSideSet, isWarmupRow } from './workout-model.js'
import { isoOf } from './format.js'
import { effectiveRoutineIds } from './history.js'
import { queueOf } from './queue.js'

const dateOK = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && isoOf(new Date(d + 'T12:00:00')) === d
export const completedDateOf = w => Number.isFinite(w.end) && w.end > 0 ? isoOf(new Date(w.end)) : dateOK(w.d) ? w.d : null
const unique = values => [...new Set(Array.isArray(values) ? values.filter(v => typeof v === 'string' && v) : [])]
const targetOf = (policy, muscle) => {
  const t = policy.targets?.[muscle] || {}
  return { directDays: Number.isFinite(t.directDays) && t.directDays >= 0 ? t.directDays : 2, sets: Number.isFinite(t.sets) && t.sets >= 0 ? t.sets : null }
}
const empty = target => ({ directSets: 0, secondarySets: 0, secondaryCredit: 0, combinedEstimate: 0, directDates: [], secondaryDates: [], secondaryOnlyDates: [], undatedSets: 0, target, gap: { directDays: target.directDays, sets: target.sets } })
const unknown = () => ({ targetSets: 0, roleSets: 0, phaseRows: 0, completionRows: 0, partialRows: 0, dateSessions: 0, prescriptionEntries: 0, acceptanceSessions: 0 })

// Secondary credit is a reporting estimate, independent of legacy recovery accounting.
export function trainingCoverage({ workouts = [], plannedSessions = [], metadata = {}, policy = {}, window }) {
  const byMuscle = {}, byRole = {}, unknowns = { actual: unknown(), planned: unknown() }
  const muscle = m => byMuscle[m] ||= { actual: empty(targetOf(policy, m)), planned: empty(targetOf(policy, m)) }
  Object.keys(policy.targets || {}).forEach(muscle)
  for (const [kind, sessions] of [['actual', workouts], ['planned', plannedSessions]]) {
    const seen = new Set()
    for (const session of sessions) {
      const key = session.id || `${session.d || session.date}|${session.start}`
      if (seen.has(key)) continue
      seen.add(key)
      const date = kind === 'actual' ? completedDateOf(session) : dateOK(session.date) ? session.date : null
      if (date && (date < window.startDate || date > window.endDate)) continue
      if (!date) { unknowns[kind].dateSessions++; if (kind === 'actual') continue }
      for (const entry of session.entries || []) {
        let count = 0
        if (kind === 'planned' && typeof entry.sets === 'number' && Number.isInteger(entry.sets) && entry.sets >= 0) count = entry.sets
        else if (Array.isArray(entry.sets)) {
          for (const row of entry.sets) {
            if (row.phase != null && !['work', 'warmup', 'warm-up', 'warm_up'].includes(String(row.phase).trim().toLowerCase())) { unknowns[kind].phaseRows++; continue }
            if (isWarmupRow(row)) continue
            if (kind === 'planned') { count++; continue }
            if (isSideSet(row) && !(row.sides.L.done === true && row.sides.R.done === true)) {
              if (hasCompletedWork(row)) unknowns[kind].partialRows++
              else if (row.sides.L.done == null || row.sides.R.done == null) unknowns[kind].completionRows++
              continue
            }
            if (row.done === true) count++
            else if (row.done == null) unknowns[kind].completionRows++
          }
        } else unknowns[kind][kind === 'planned' ? 'prescriptionEntries' : 'completionRows']++
        if (!count) continue
        const ex = EXIDX[entry.id] || entry
        const meta = trainingMetadataOf({ ...ex, ...entry, ...(metadata[entry.id] ? { trainingMetadata: metadata[entry.id] } : {}) })
        const primary = unique(meta.primary), secondary = unique(meta.secondary).filter(m => !primary.includes(m))
        if (!primary.length) unknowns[kind].targetSets += count
        if (!TRAINING_ROLES.includes(meta.role)) unknowns[kind].roleSets += count
        else {
          const role = (byRole[meta.role] ||= { actual: { sets: 0, dates: [], undatedSets: 0 }, planned: { sets: 0, dates: [], undatedSets: 0 } })[kind]
          role.sets += count
          if (date) role.dates = unique([...role.dates, date]).sort()
          else role.undatedSets += count
        }
        for (const [targets, field, dates] of [[primary, 'directSets', 'directDates'], [secondary, 'secondarySets', 'secondaryDates']]) for (const m of targets) {
          const record = muscle(m)[kind]
          record[field] += count
          if (date) record[dates] = unique([...record[dates], date]).sort()
          else record.undatedSets += count
        }
      }
    }
  }
  for (const pair of Object.values(byMuscle)) for (const record of Object.values(pair)) {
    record.secondaryCredit = record.secondarySets * 0.5
    record.combinedEstimate = record.directSets + record.secondaryCredit
    record.secondaryOnlyDates = record.secondaryDates.filter(d => !record.directDates.includes(d))
    record.gap = { directDays: record.undatedSets ? null : Math.max(0, record.target.directDays - record.directDates.length), sets: record.target.sets == null ? null : Math.max(0, record.target.sets - record.combinedEstimate) }
  }
  return { byMuscle, byRole, unknowns, window }
}

/** Dates are local reporting boundaries, never inferred training availability. */
export function coverageForState(S, today) {
  const first = new Date(today + 'T12:00:00'); first.setDate(first.getDate() - 6)
  const window = { startDate: isoOf(first), endDate: today }
  const policy = { targets: S.coverageTargets || {} }
  const plannedSessions = []
  const plannedEntries = id => (S.routines.find(r => r.id === id)?.ex || []).map(cfg => ({ ...S.customEx?.find(ex => ex.id === cfg.id), ...cfg }))
  // Fixed-day prescriptions are dated. Floating cycle sessions stay undated in cycle context.
  const q = queueOf(S)
  const fixed = { ...S, week: S.week || {}, dayPlan: S.dayPlan || {}, workouts: S.workouts || [], queue: null }
  for (let date = new Date(first); isoOf(date) <= today; date.setDate(date.getDate() + 1)) {
    const d = isoOf(date)
    for (const id of unique(effectiveRoutineIds(fixed, d, today)).filter(id => !q?.ids.includes(id) || S.dayPlan?.[d] === id)) {
      plannedSessions.push({ id: `${d}:${id}`, date: d, entries: plannedEntries(id) })
    }
  }
  const args = { metadata: S.trainingMetadata || {}, policy }
  const rolling = trainingCoverage({ ...args, window, workouts: S.workouts || [], plannedSessions })
  let cycle = null
  if (q) {
    const startDate = q.startsOn
    const ambiguous = new Set()
    const cycleWorkouts = (S.workouts || []).filter(w => {
      const date = completedDateOf(w)
      if (!date || date < startDate || date > today) return false
      if (!Number.isFinite(q.since)) return true
      if (Number.isFinite(w.end) && w.end > 0) return w.end >= q.since
      if (date > isoOf(new Date(q.since))) return true
      // A legacy day without a completion time cannot be assigned across acceptance that day.
      ambiguous.add(w.id || `${w.d}|${w.start}`)
      return false
    })
    cycle = trainingCoverage({ ...args, window: { startDate, endDate: today < startDate ? startDate : today }, workouts: cycleWorkouts,
      plannedSessions: q.ids.map(id => ({ id, entries: plannedEntries(id) })) })
    // A cycle has no fixed duration; weekly aims only produce gaps in the rolling view.
    for (const pair of Object.values(cycle.byMuscle)) for (const value of Object.values(pair)) value.gap = { directDays: null, sets: null }
    cycle.unknowns.actual.acceptanceSessions = ambiguous.size
    cycle.label = q.label || null
  }
  return { rolling, cycle }
}
