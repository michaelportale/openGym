// Home's glance at training coverage: one bar per muscle for the last 7 days,
// completed estimated sets against planned ones. The full report — the cycle view, the per-muscle
// counts, the method note and the aims editor — is the same TrainingCoverage card Plan shows,
// opened in a sheet from here, so nothing it offers went away.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coverageForState } from '../lib/training-coverage.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import TrainingCoverage from './TrainingCoverage.jsx'

// The sheet reads the store itself, so saving an aim inside it redraws it at once.
function CoverageSheet() {
  const S = useStore(s => s.S)
  return <div className="coverage-sheet"><TrainingCoverage S={S} /></div>
}
export const coverageSheet = () => useUI.getState().openSheet(() => <CoverageSheet />)

/** Rows for the glance, in the body map's muscle order: only muscles with work done or planned. */
export function glanceRows(byMuscle) {
  const known = MUSCLES.filter(m => byMuscle?.[m])
  const rest = Object.keys(byMuscle || {}).filter(m => !known.includes(m))
  return [...known, ...rest].map(m => {
    const done = Number(byMuscle[m]?.actual?.combinedEstimate) || 0
    const planned = Number(byMuscle[m]?.planned?.combinedEstimate) || 0
    return { m, done, planned, met: planned > 0 && done >= planned, fill: done + planned > 0 ? Math.min(1, done / Math.max(done, planned)) : 0 }
  }).filter(r => r.done > 0 || r.planned > 0)
}

export default function CoverageGlance({ S }) {
  const rows = glanceRows(coverageForState(S, todayISO()).rolling.byMuscle)
  // Nothing done or planned this week: no card. Plan still shows the full report and its aims.
  if (!rows.length) return null
  // One button whose name is its own text, so a screen reader hears every muscle and number;
  // an aria-label here would replace all of it with the title.
  return <div className="card coverage-glance tappable" {...tappable(coverageSheet)}>
    <div className="row between coverage-glance-h">
      <div>
        <div className="lbl2">{t('Last 7 days')}</div>
        <h2>{t('Training coverage')}</h2>
      </div>
      <Icon name="chevronRight" className="chev" />
    </div>
    <div className="coverage-bars">
      {rows.map(r => <div className={'coverage-bar' + (r.met ? ' met' : '')} key={r.m}>
        <div className="coverage-bar-t">
          <span className="coverage-bar-n">{t(MUSCLE_NAME[r.m] || r.m)}</span>
          <span className="coverage-bar-v">{r.met && <Icon name="check" />}{fmtNum(r.done)}{r.planned > 0 ? ' / ' + fmtNum(r.planned) : ''}</span>
        </div>
        <div className="coverage-bar-track" aria-hidden="true"><div className="coverage-bar-fill" style={{ width: (r.fill * 100).toFixed(1) + '%' }} /></div>
      </div>)}
    </div>
  </div>
}
