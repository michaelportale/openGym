import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { modeOf, setLabel } from '../lib/history.js'
import { sessionHistory } from '../lib/backfill.js'
import { comparableEntries, suggestProgression } from '../lib/progression-suggestion.js'
import { effortColor, loggedRirOf } from '../lib/effort.js'
import { isSideSet, isWarmupRow, setSideField } from '../lib/workout-model.js'
import { POLICY_NAME, policyFor } from '../lib/progression.js'
import { ownedWeightsFor } from '../lib/dumbbells.js'
import { effortPickerSheet } from '../sheets.jsx'
import { Button } from './ui.jsx'

// Shared across Focus and the card/list layouts: optional final effort is always in reach.
export default function StrengthFeedback({ entryIdx, onProgressionSettings }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const entry = S.active?.entries?.[entryIdx]
  if (!entry || modeOf({ ...entry.target, id: entry.id }) !== 'reps') return null
  const finalIdx = entry.sets.findLastIndex(s => !isWarmupRow(s))
  const final = entry.sets[finalIdx]
  if (!final) return null
  const cfg = { ...entry.target, id: entry.id }
  const routine = S.routines.find(r => r.id === entry.rid)
  const policy = entry.noProg ? 'off' : policyFor(cfg, routine)
  const owned = ownedWeightsFor(S, cfg)
  const prescription = { ...cfg, ...entry.planned, ...(owned ? { availableLoads: owned } : {}) }
  const H = sessionHistory(S)
  const prior = comparableEntries({ exercise: entry, history: H, prescription })[0]
  const suggestion = suggestProgression({ exercise: entry, history: H, prescription, policy })
  const edit = ['increase-load', 'limited-load', 'increase-reps', 'hold'].includes(suggestion.action)
  const activeId = S.active.id
  const pick = side => {
    const row = side ? final.sides[side] : final
    effortPickerSheet('rir', loggedRirOf(row), value => update(s => {
      const fresh = s.active?.id === activeId && s.active.entries?.[entryIdx]
      // A sheet can outlive a reordered entry or an added set. Never rate a different row.
      if (!fresh || fresh.id !== entry.id || fresh.sets.length !== entry.sets.length
        || fresh.sets.findLastIndex(r => !isWarmupRow(r)) !== finalIdx) return
      if (side) fresh.sets[finalIdx] = setSideField(setSideField(fresh.sets[finalIdx], side, 'rpe', null), side, 'rir', value)
      else {
        delete fresh.sets[finalIdx].rpe
        if (value == null) delete fresh.sets[finalIdx].rir
        else fresh.sets[finalIdx].rir = value
      }
    }))
  }
  const effortButton = side => {
    const rir = loggedRirOf(side ? final.sides[side] : final)
    const label = t('Final working set RIR') + (side ? ' · ' + t(side) : '')
    return <Button key={side || 'set'} variant="ghost" aria-label={label}
      style={{ color: effortColor(rir) || 'var(--label)', border: '1px solid var(--sep)', minHeight: 44 }}
      onClick={() => pick(side)}>{label}: {rir == null ? t('Optional') : fmtNum(rir)}</Button>
  }
  return <div className="strength-feedback" style={{ marginBlock: 12 }}>
    {entry.equipmentSnapshot && <div className="small dim" style={{ marginBottom: 8 }}>
      {prior ? <>{t('Comparable history')} · {fmtDate(prior.d)}: {prior.sets.filter(s => s.done && !isWarmupRow(s)).map(s => setLabel(entry.id, s, prior.target)).join(', ')}</> : t('No comparable history')}
    </div>}
    {policy === 'double' && <div className="small" style={{ marginBottom: 8 }}>
      <strong>{t('This session: editable suggestion from comparable history')}</strong>
      {prior && <> · {fmtNum(suggestion.load)} {entry.equipmentSnapshot?.unit || ''} × {suggestion.reps}
        {suggestion.percentChange != null && <> (+{fmtNum(suggestion.percentChange)}%)</>}</>}
      <div>{suggestion.reasons.map(r => t(r)).join(' · ')}{suggestion.limitations.length > 0 && ' · ' + suggestion.limitations.map(r => t(r)).join(' · ')}</div>
      <div className="dim">{t('Selected policy: {0}. This suggestion applies only after you edit and save this session.', t(POLICY_NAME[policy]))}</div>
      {edit && onProgressionSettings && <Button size="sm" variant="ghost" aria-label={t('Edit this session’s prescription')}
        onClick={() => onProgressionSettings(suggestion)}>{t('Edit this session’s prescription')}</Button>}
    </div>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{isSideSet(final) ? ['L', 'R'].map(effortButton) : effortButton()}</div>
    <div className="small dim">{t('Rate only the final working set. You can finish without a rating.')}</div>
  </div>
}
