import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { coverageForState } from '../lib/training-coverage.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { TRAINING_ROLES } from '../lib/training-metadata.js'
import { todayISO, fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button, NumberField, Segmented, SelectRow } from './ui.jsx'

const ROLE_NAMES = ['Horizontal press', 'Vertical press', 'Horizontal pull', 'Vertical pull', 'Squat', 'Hinge', 'Chest isolation', 'Shoulder isolation', 'Elbow flexion', 'Elbow extension', 'Knee flexion', 'Knee extension', 'Calf raise', 'Core']
// The "could not be counted" lines, as [field, text], leaving out the zeroes. Each line is a
// literal t() call so the source-string check sees every key.
const UNKNOWN_LINES = [
  ['targetSets', n => t('Sets with unknown targets: {0}', n)], ['roleSets', n => t('Sets with unknown role: {0}', n)],
  ['phaseRows', n => t('Rows with unknown working-set status: {0}', n)], ['completionRows', n => t('Rows with unknown completion: {0}', n)],
  ['partialRows', n => t('Partially completed limb rows: {0}', n)], ['dateSessions', n => t('Sessions without known dates: {0}', n)],
  ['prescriptionEntries', n => t('Entries without known set counts: {0}', n)], ['acceptanceSessions', n => t('Sessions with unknown cycle timing: {0}', n)],
]
export const unknownLines = u => UNKNOWN_LINES.filter(([k]) => u?.[k] > 0).map(([k, line]) => [k, line(u[k])])
export const hasUnknowns = unknowns => ['actual', 'planned'].some(kind => unknownLines(unknowns?.[kind]).length > 0)
function Counts({ value, planned, cycle }) {
  return <div className="coverage-counts small">
    <strong>{planned ? t('Planned: {0} estimated sets', fmtNum(value.combinedEstimate)) : t('Completed: {0} estimated sets', fmtNum(value.combinedEstimate))}</strong>
    <div>{t('Direct sets: {0}', fmtNum(value.directSets))}</div>
    <div>{t('Secondary sets: {0} · estimated credit: {1}', fmtNum(value.secondarySets), fmtNum(value.secondaryCredit))}</div>
    <div>{t('Direct-work days: {0}', value.directDates.length)}</div>
    <div>{t('Secondary-only days: {0}', value.secondaryOnlyDates.length)}</div>
    {!!value.directDates.length && <div className="muted">{value.directDates.map(d => fmtDate(d, true)).join(' · ')}</div>}
    {!!value.undatedSets && <div>{t('Undated planned sets: {0}', value.undatedSets)}</div>}
    {!cycle && <div className="muted">{t('Direct-day gap to aim: {0}', value.gap.directDays ?? t('Unknown'))}</div>}
    {!cycle && value.gap.sets != null && <div className="muted">{t('Estimated-set gap to aim: {0}', fmtNum(value.gap.sets))}</div>}
  </div>
}
function TargetEditor({ S }) {
  const update = useStore(s => s.update)
  const [muscle, setMuscle] = useState('chest')
  const target = S.coverageTargets?.[muscle]
  const [days, setDays] = useState(target?.directDays ?? 2)
  const [sets, setSets] = useState(target?.sets ?? null)
  const choose = m => { setMuscle(m); setDays(S.coverageTargets?.[m]?.directDays ?? 2); setSets(S.coverageTargets?.[m]?.sets ?? null) }
  const valid = Number.isInteger(days) && days >= 0 && days <= 7 && (sets == null || (Number.isFinite(sets) && sets >= 0))
  return <details className="coverage-targets">
    <summary>{t('Set your aims')}</summary>
      <SelectRow title={t('Muscle group')} value={muscle} options={MUSCLES.map(m => ({ value: m, label: t(MUSCLE_NAME[m]) }))} onChange={choose} />
    <form onSubmit={e => { e.preventDefault(); if (valid) update(s => { s.coverageTargets ||= {}; s.coverageTargets[muscle] = { directDays: days, sets, _ts: Date.now() } }) }}>
      <label className="measure-field"><span>{t('Direct-work day aim')}</span><NumberField aria-label={t('Direct-work day aim')} value={days} decimal={false} onChange={setDays} /></label>
      <label className="measure-field"><span>{t('Estimated set aim (optional)')}</span><NumberField aria-label={t('Estimated set aim (optional)')} value={sets} nullable onChange={setSets} /></label>
      <Button type="submit" size="sm" variant="tinted" disabled={!valid}>{t('Save aims')}</Button>
    </form>
  </details>
}
export default function TrainingCoverage({ S }) {
  const [view, setView] = useState('rolling')
  const result = coverageForState(S, todayISO())
  const cycle = view === 'cycle' && result.cycle
  const data = cycle || result.rolling
  const muscles = Object.entries(data.byMuscle)
  return <section className="card training-coverage" aria-label={t('Training coverage')}>
    <h2>{t('Training coverage')}</h2>
    {result.cycle && <Segmented value={cycle ? 'cycle' : 'rolling'} onChange={setView} options={[{ value: 'rolling', label: t('Last 7 days') }, { value: 'cycle', label: t('Accepted cycle') }]} />}
    <p className="small muted">{!cycle && t('Last 7 days') + ' · '}{fmtDate(data.window.startDate, true)} – {fmtDate(data.window.endDate, true)}{cycle && data.label ? ' · ' + data.label : ''}</p>
    {cycle && <p className="small muted">{t('Cycle totals include off-program work since acceptance. Floating plans have no assumed training dates.')}</p>}
    {muscles.length === 0 && <p className="small muted">{t('No sets in these days yet.')}</p>}
    {muscles.map(([m, value]) => <details className="coverage-muscle" key={m}>
      <summary><span>{t(MUSCLE_NAME[m] || m)}</span><span className="small muted">{t('{0} of {1} planned sets done', fmtNum(value.actual.combinedEstimate), fmtNum(value.planned.combinedEstimate))}</span></summary>
      <div className="coverage-pair"><Counts value={value.actual} cycle={!!cycle} /><Counts value={value.planned} planned cycle={!!cycle} /></div>
      {!cycle && <p className="small muted">{t('Your aim: {0} direct-work days per 7 days', value.actual.target.directDays)}{value.actual.target.sets != null ? ' · ' + t('Your estimated-set aim: {0}', fmtNum(value.actual.target.sets)) : ''}</p>}
    </details>)}
    {cycle && <p className="small muted">{t('Frequency gap unknown for undated plans.')}</p>}
    <details className="coverage-extra"><summary>{t('By movement')}</summary>
      {Object.entries(data.byRole).map(([role, value]) => <p className="small" key={role}>{t(ROLE_NAMES[TRAINING_ROLES.indexOf(role)] || role)} · {t('{0} completed · {1} planned', value.actual.sets, value.planned.sets)}</p>)}
    </details>
    {/* What the counts above could not place. Only when there is something, and only the
        lines that are not zero: a list of zeroes read as a list of problems. */}
    {hasUnknowns(data.unknowns) && <details className="coverage-extra"><summary>{t('Sets that could not be counted')}</summary>
      {['actual', 'planned'].filter(kind => unknownLines(data.unknowns[kind]).length).map(kind => <div className="small" key={kind}><strong>{kind === 'actual' ? t('Completed records') : t('Planned records')}</strong>
        {unknownLines(data.unknowns[kind]).map(([k, text]) => <div key={k}>{text}</div>)}
      </div>)}
    </details>}
    <p className="sect-f">{t('A set where a muscle only helps counts as half a set.')}</p>
    <TargetEditor S={S} />
  </section>
}
