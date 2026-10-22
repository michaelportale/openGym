import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { modeOf, setLabel } from '../lib/history.js'
import { sessionHistory } from '../lib/backfill.js'
import { comparableEntries, suggestProgression } from '../lib/progression-suggestion.js'
import { loggedRirOf } from '../lib/effort.js'
import { isSideSet, isWarmupRow, setSideField } from '../lib/workout-model.js'
import { POLICY_NAME, policyFor } from '../lib/progression.js'
import { ownedWeightsFor } from '../lib/dumbbells.js'
import { effortPickerSheet } from '../sheets.jsx'
import { Button } from './ui.jsx'

const LOAD_LABELS = {
  'barbell-total': 'Barbell total', 'db-per-hand': 'Dumbbell per hand',
  'db-total': 'Dumbbells total', 'plate-per-side': 'Plate-loaded per side',
  'machine-setting': 'Machine setting', 'machine-total': 'Machine total',
}

// Read the session's saved identity; a current gym profile cannot establish what was logged.
export function EquipmentIdentity({ entry }) {
  const snapshot = entry.equipmentSnapshot
  const convention = snapshot ? snapshot.loadConvention : entry.target?.loadConvention
  return <dl className="equipment-identity" aria-label={t('Equipment')}>
    <div><dt>{t('Equipment station')}</dt><dd>{snapshot?.label || t('Unknown')}
      {snapshot?.label && snapshot.status !== 'exact' && <span> · {t('Unknown')}</span>}
    </dd></div>
    <div><dt>{t('Load convention')}</dt><dd>{t(LOAD_LABELS[convention] || 'Unknown')}</dd></div>
  </dl>
}

// Shared across Focus and the card/list layouts: optional final effort is always in reach.
// Sections let the same feedback frame the actual controls without duplicating its write path.
export default function StrengthFeedback({ entryIdx, onProgressionSettings, section = 'all' }) {
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
  const context = section !== 'effort'
  const H = context ? sessionHistory(S) : null
  const prior = context ? comparableEntries({ exercise: entry, history: H, prescription })[0] : null
  const suggestion = context ? suggestProgression({ exercise: entry, history: H, prescription, policy }) : null
  const edit = suggestion && ['increase-load', 'limited-load', 'increase-reps', 'hold'].includes(suggestion.action)
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
    return <Button key={side || 'set'} variant="ghost" className="strength-effort-button" aria-label={label}
      onClick={() => pick(side)}><span>{label}</span><strong>{rir == null ? t('Optional') : fmtNum(rir)}</strong></Button>
  }
  return <div className={'strength-feedback strength-feedback-' + section}>
    {context && <>
      {entry.sets.some(row => row.loadNeedsReview) && <p className="strength-load-review" role="status">{t('Choose the load for this copied exercise before logging it.')}</p>}
      {entry.equipmentSnapshot && <div className="strength-comparison">
        {prior ? <>{t('Comparable history')} · {fmtDate(prior.d)}: {prior.sets.filter(s => s.done && !isWarmupRow(s)).map(s => setLabel(entry.id, s, prior.target)).join(', ')}</> : t('No comparable history')}
      </div>}
      {policy === 'double' && <details className="strength-prescription">
        <summary>{t('Progression settings')}<span>{t(POLICY_NAME[policy])}</span></summary>
        <div className="strength-prescription-body">
          <div><strong>{t('This session: editable suggestion from comparable history')}</strong>
            {prior && <> · {fmtNum(suggestion.load)} {entry.equipmentSnapshot?.unit || ''} × {suggestion.reps}
              {suggestion.percentChange != null && <> (+{fmtNum(suggestion.percentChange)}%)</>}</>}
          </div>
          <div>{suggestion.reasons.map(r => t(r)).join(' · ')}{suggestion.limitations.length > 0 && ' · ' + suggestion.limitations.map(r => t(r)).join(' · ')}</div>
          <div>{t('Selected policy: {0}. This suggestion applies only after you edit and save this session.', t(POLICY_NAME[policy]))}</div>
          {edit && onProgressionSettings && <Button size="sm" variant="ghost" aria-label={t('Edit this session’s prescription')}
            onClick={() => onProgressionSettings(suggestion)}>{t('Edit this session’s prescription')}</Button>}
        </div>
      </details>}
    </>}
    {section !== 'context' && <div className="strength-effort">
      <div className="strength-effort-controls">{isSideSet(final) ? ['L', 'R'].map(effortButton) : effortButton()}</div>
      <p>{t('Rate only the final working set. You can finish without a rating.')}</p>
    </div>}
  </div>
}
