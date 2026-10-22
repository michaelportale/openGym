import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { coverageForState } from '../lib/training-coverage.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { TRAINING_ROLES } from '../lib/training-metadata.js'
import { todayISO, fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button, NumberField, Segmented, SelectRow } from './ui.jsx'

const ROLE_NAMES = ['Horizontal press', 'Vertical press', 'Horizontal pull', 'Vertical pull', 'Squat', 'Hinge', 'Chest isolation', 'Shoulder isolation', 'Elbow flexion', 'Elbow extension', 'Knee flexion', 'Knee extension', 'Calf raise', 'Core']
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
    <summary>{t('Edit coverage aims')}</summary>
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
    <p className="small muted">{cycle ? t('Cycle totals include off-program work since acceptance. Floating plans have no assumed training dates.') : t('Planned values use current dated prescriptions. Floating sessions appear in cycle context. No log does not mean missed.')}</p>
    {muscles.length === 0 && <p className="small muted">{t('No mapped work in this window. Unknown records are listed below.')}</p>}
    {muscles.map(([m, value]) => <details className="coverage-muscle" key={m}>
      <summary><span>{t(MUSCLE_NAME[m] || m)}</span><span className="small muted">{t('Estimated sets: {0} completed · {1} planned', fmtNum(value.actual.combinedEstimate), fmtNum(value.planned.combinedEstimate))}</span></summary>
      <div className="coverage-pair"><Counts value={value.actual} cycle={!!cycle} /><Counts value={value.planned} planned cycle={!!cycle} /></div>
      {!cycle && <p className="small muted">{t('Your aim: {0} direct-work days per 7 days', value.actual.target.directDays)}{value.actual.target.sets != null ? ' · ' + t('Your estimated-set aim: {0}', fmtNum(value.actual.target.sets)) : ''}</p>}
    </details>)}
    {cycle && <p className="small muted">{t('Frequency gap unknown for undated plans.')}</p>}
    <details className="coverage-extra"><summary>{t('Movement roles')}</summary>
      {Object.entries(data.byRole).map(([role, value]) => <p className="small" key={role}>{t(ROLE_NAMES[TRAINING_ROLES.indexOf(role)] || role)} · {t('{0} completed · {1} planned', value.actual.sets, value.planned.sets)}</p>)}
    </details>
    <details className="coverage-extra"><summary>{t('Unknown / unclassified')}</summary>
      {['actual', 'planned'].map(kind => <div className="small" key={kind}><strong>{kind === 'actual' ? t('Completed records') : t('Planned records')}</strong>
        <div>{t('Sets with unknown targets: {0}', data.unknowns[kind].targetSets)}</div>
        <div>{t('Sets with unknown role: {0}', data.unknowns[kind].roleSets)}</div>
        <div>{t('Rows with unknown working-set status: {0}', data.unknowns[kind].phaseRows)}</div>
        <div>{t('Rows with unknown completion: {0}', data.unknowns[kind].completionRows)}</div>
        <div>{t('Partially completed limb rows: {0}', data.unknowns[kind].partialRows)}</div>
        <div>{t('Sessions without known dates: {0}', data.unknowns[kind].dateSessions)}</div>
        <div>{t('Entries without known set counts: {0}', data.unknowns[kind].prescriptionEntries)}</div>
        {!!data.unknowns[kind].acceptanceSessions && <div>{t('Sessions with unknown cycle timing: {0}', data.unknowns[kind].acceptanceSessions)}</div>}
      </div>)}
    </details>
    <p className="sect-f">{t('Secondary credit uses 0.5 per set. Day aims describe your schedule, not stimulus adequacy.')}</p>
    <TargetEditor S={S} />
  </section>
}
