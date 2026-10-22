import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { allExercises, searchExercises } from '../lib/exercises.js'
import { activeProfile, equipmentMatch } from '../lib/equipment.js'
import { rankReplacements } from '../lib/similar-exercises.js'
import { equipmentSnapshotFor } from '../lib/load-identity.js'
import { defaultConfig, modeOf, setLabel } from '../lib/history.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

// A presentation check only: the existing swap builder still owns all load/history decisions.
export function replacementNeedsLoadReview(current, replacement) {
  if (modeOf({ ...replacement.target, id: replacement.id }) === 'cardio') return false
  const before = current.equipmentSnapshot
  const after = replacement.equipmentSnapshot
  const machine = ['machine-setting', 'machine-total', 'plate-per-side'].includes(after?.loadConvention)
  return !before?.loadConvention || !after?.loadConvention
    || before.loadConvention !== after.loadConvention
    || before.unit !== after.unit
    || machine && (!before.stationId || !after.stationId || before.status !== 'exact' || after.status !== 'exact')
    || (before.stationId || after.stationId) && before.stationId !== after.stationId
}

function Identity({ snapshot, loadLabels }) {
  return <dl className="replacement-identity">
    <div><dt>{t('Equipment station')}</dt><dd>{snapshot?.label || t('Unknown')}</dd></div>
    <div><dt>{t('Load convention')}</dt><dd>{t(loadLabels[snapshot?.loadConvention] || 'Unknown')}</dd></div>
  </dl>
}

export function ReplacementLoadReview({ current, replacement, exercise, loadLabels, onConfirm, onEdit }) {
  return <div className="workout-replacements replacement-review">
    <h3>{t('Review starting load')}</h3>
    <p className="replacement-intro">{t('Review the station and load meaning before using these starting sets.')}</p>
    <h4 className="replacement-name">{exerciseNameFor(exercise)}</h4>
    <Identity snapshot={replacement.equipmentSnapshot} loadLabels={loadLabels} />
    <p className="replacement-change">{t('Load convention')}: {t(loadLabels[current.equipmentSnapshot?.loadConvention] || 'Unknown')} → {t(loadLabels[replacement.equipmentSnapshot?.loadConvention] || 'Unknown')}</p>
    <ol className="replacement-starting-sets" aria-label={t('Review starting load')}>
      {replacement.sets.filter(set => !isWarmupRow(set)).map((set, index) => <li key={index}>
        <span>{t('Set {0}', index + 1)}</span><strong>{setLabel(replacement.id, set, replacement.target)}{replacement.equipmentSnapshot?.unit ? ` ${replacement.equipmentSnapshot.unit}` : ''}</strong>
      </li>)}
    </ol>
    <p className="replacement-intro">{t('Your future plan is unchanged.')}</p>
    <Button className="replacement-primary" onClick={onConfirm}>{t('Use in this workout')}</Button>
    <Button variant="ghost" onClick={onEdit}>{t('Edit settings')}</Button>
  </div>
}

// Active-workout chooser only. General library/routine pickers keep their existing controls.
export default function WorkoutReplacementSheet({ onPick, like, entry, loadLabels }) {
  const st = useStore(s => s.S)
  const [query, setQuery] = useState('')
  const [all, setAll] = useState(false)
  const [shown, setShown] = useState(12)
  const [excluded, setExcluded] = useState([])
  const searchRef = useRef(null)
  const onSearchFocus = useSheetKeyboard(searchRef)
  const selectedProfile = st.equipProfiles?.find(profile => profile.id === st.activeEquipId)
  const profile = activeProfile(st)
  const candidates = allExercises(st)
  const recommendations = rankReplacements({ exercise: like, candidates,
    profile: profile || (excluded.length ? selectedProfile : null), excludedStationIds: excluded,
    workouts: st.workouts, metadata: st.trainingMetadata })
  const reasons = new Map(recommendations.map(row => [row.exercise.id, row.reasons[0]]))
  const pool = all ? candidates.filter(ex => ex.id !== like.id && equipmentMatch(profile, ex).available) : recommendations.map(row => row.exercise)
  const results = searchExercises(pool, query)
  return <div className="workout-replacements">
    <h3>{t('Swap exercise')}</h3>
    <p className="replacement-intro">{exerciseNameFor(like)} · {t('Your future plan is unchanged.')}</p>
    <div className="picker-search replacement-search">
      <label className="replacement-search-label"><Icon name="magnifier" />
        <input ref={searchRef} className="input" aria-label={t('Search {0} exercises…', candidates.length)} placeholder={t('Search {0} exercises…', candidates.length)} value={query}
          onFocus={onSearchFocus} onChange={event => { setQuery(event.target.value); setShown(12) }} />
      </label>
    </div>
    <div className="chips replacement-scope" aria-label={t('Suggested replacements')}>
      <button className={'chip nocap' + (!all ? ' on' : '')} aria-pressed={!all} onClick={() => { setAll(false); setShown(12) }}>{t('Suggested replacements')}</button>
      <button className={'chip nocap' + (all ? ' on' : '')} aria-pressed={all} onClick={() => { setAll(true); setShown(12) }}>{t('All')}</button>
    </div>
    {selectedProfile?.stations?.length > 0 && <details className="replacement-occupied">
      <summary>{t('Temporarily exclude occupied stations')}</summary>
      <p>{t('Applies to these suggestions only. All keeps manual search available.')}</p>
      {selectedProfile.stations.map(station => <label key={station.id}>
        <input type="checkbox" aria-label={t('Occupied station: {0}', station.label)} checked={excluded.includes(station.id)}
          onChange={() => setExcluded(ids => ids.includes(station.id) ? ids.filter(id => id !== station.id) : [...ids, station.id])} />
        <span>{station.label}</span>
      </label>)}
    </details>}
    <div className="list replacement-results">
      {results.slice(0, shown).flatMap(ex => {
        const match = equipmentMatch(selectedProfile, ex, all ? [] : excluded)
        const stations = match.stationIds.length ? match.stationIds : [null]
        return stations.map(stationId => {
          const station = selectedProfile?.stations?.find(row => row.id === stationId)
          const cfg = { ...defaultConfig(ex.id), ...(stationId ? { stationId } : {}), ...(station?.loadConvention ? { loadConvention: station.loadConvention } : {}) }
          const snapshot = equipmentSnapshotFor(st, { ...cfg, id: ex.id })
          const review = replacementNeedsLoadReview(entry, { id: ex.id, target: cfg, equipmentSnapshot: snapshot })
          return <button type="button" key={`${ex.id}:${stationId || ''}`} className="item replacement-option" onClick={() => onPick(ex, false, cfg)}>
            <span className="replacement-option-body">
              <strong className="replacement-name">{exerciseNameFor(ex)}</strong>
              <span className="replacement-station">{snapshot.label || t('Equipment station') + ': ' + t('Unknown')}</span>
              <span className="replacement-basis">{t('Load convention')}: {t(loadLabels[snapshot.loadConvention] || 'Unknown')}{snapshot.unit ? ` · ${snapshot.unit}` : ''}</span>
              <span className="replacement-reason">{t(reasons.get(ex.id) || 'Training metadata unverified')}</span>
              {review && <span className="replacement-review-hint">{t('Review starting load')}</span>}
            </span><Icon name="chevronRight" />
          </button>
        })
      })}
      {!results.length && <p className="replacement-empty" role="status">{t('No replacements in this view. Try All or change the search.')}</p>}
    </div>
    {results.length > shown && <Button variant="ghost" onClick={() => setShown(count => count + 12)}>{t('Show more')}</Button>}
  </div>
}
