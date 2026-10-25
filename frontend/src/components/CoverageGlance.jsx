// Home's glance at training coverage: one bar per muscle for the last 7 days,
// completed estimated sets against planned ones. The full report — the cycle view, the per-muscle
// counts, the method note and the aims editor — is the same TrainingCoverage card Plan shows,
// opened in a sheet from here, so nothing it offers went away.
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coverageForState } from '../lib/training-coverage.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { todayISO, fmtNum } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import TrainingCoverage from './TrainingCoverage.jsx'

// The sheet reads the store itself, so saving an aim inside it redraws it at once.
function CoverageSheet() {
  const S = useStore(s => s.S)
  return <div className="coverage-sheet"><TrainingCoverage S={S} /></div>
}
export const coverageSheet = () => useUI.getState().openSheet(() => <CoverageSheet />)

/** Rows for the glance: only muscles with work done or planned, with whether the aim is met and
 *  how far behind it the week is (planned minus done, never below zero). */
export function glanceRows(byMuscle) {
  const known = MUSCLES.filter(m => byMuscle?.[m])
  const rest = Object.keys(byMuscle || {}).filter(m => !known.includes(m))
  return [...known, ...rest].map(m => {
    const done = Number(byMuscle[m]?.actual?.combinedEstimate) || 0
    const planned = Number(byMuscle[m]?.planned?.combinedEstimate) || 0
    return { m, done, planned, behind: Math.max(0, planned - done), met: planned > 0 && done >= planned, fill: done + planned > 0 ? Math.min(1, done / Math.max(done, planned)) : 0 }
  }).filter(r => r.done > 0 || r.planned > 0)
}

/** The glance's order: what is most behind first, then work done without a plan; muscles on
 *  target are counted on one line rather than listed (`met`). Ties keep the body map order. */
export function glanceOrder(rows) {
  const open = rows.filter(r => !r.met)
  const behind = open.filter(r => r.behind > 0).sort((a, b) => b.behind - a.behind)
  const extra = open.filter(r => r.behind <= 0)
  return { open: [...behind, ...extra], met: rows.filter(r => r.met) }
}

// Whole sets: a muscle that only helped earns half a set, and "1.5 / 1.5" read as noise. A
// rounded figure carries "≈" so it is not taken for a count.
export function setsLabel(done, planned) {
  const whole = v => Number.isInteger(v)
  const est = !whole(done) || (planned > 0 && !whole(planned))
  return (est ? '≈' : '') + fmtNum(Math.round(done)) + (planned > 0 ? ' / ' + fmtNum(Math.round(planned)) : '')
}

export const GLANCE_ROWS = 6

export default function CoverageGlance({ S }) {
  const [all, setAll] = useState(false)
  const rows = glanceRows(coverageForState(S, todayISO()).rolling.byMuscle)
  // Nothing done or planned this week: no card. Plan still shows the full report and its aims.
  if (!rows.length) return null
  const { open, met } = glanceOrder(rows)
  const shown = all ? open : open.slice(0, GLANCE_ROWS)
  // The heading is the button that opens the full report; the rows are read as plain text, and
  // "Show all" is its own button, so no control sits inside another.
  return <div className="card coverage-glance">
    <button type="button" className="row between coverage-glance-h" onClick={coverageSheet}>
      <div>
        <div className="lbl2">{t('Last 7 days')}</div>
        <h2>{t('Training coverage')}</h2>
      </div>
      <Icon name="chevronRight" className="chev" />
    </button>
    {shown.length > 0 && <div className="coverage-bars">
      {shown.map(r => <div className="coverage-bar" key={r.m}>
        <div className="coverage-bar-t">
          <span className="coverage-bar-n">{t(MUSCLE_NAME[r.m] || r.m)}</span>
          <span className="coverage-bar-v">{setsLabel(r.done, r.planned)}</span>
        </div>
        <div className="coverage-bar-track" aria-hidden="true"><div className="coverage-bar-fill" style={{ width: (r.fill * 100).toFixed(1) + '%' }} /></div>
      </div>)}
    </div>}
    {open.length > GLANCE_ROWS && <button type="button" className="coverage-more" onClick={() => setAll(v => !v)} aria-expanded={all}>
      {all ? t('Show fewer') : t('Show all {0}', open.length)}
    </button>}
    {met.length > 0 && <div className="coverage-met"><Icon name="check" />{tn('{0} muscle on target', '{0} muscles on target', met.length)}</div>}
  </div>
}
