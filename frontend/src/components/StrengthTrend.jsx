// Stats' lead card: the lifts trained most in the last 8 weeks, each with its estimated 1RM now,
// a small line of the window's estimates and how far it moved (lib/strength-trend.js). A row
// opens that lift in Exercise progress on its estimated-1RM chart. Hidden until a lift has two
// estimates in the window.
import { useMemo } from 'react'
import { strengthTrend } from '../lib/strength-trend.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum } from '../lib/format.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'

const W = 72, H = 26
const round = v => Math.round(v * 2) / 2

export function Spark({ points }) {
  const ys = points.map(p => p.y)
  const lo = Math.min(...ys), hi = Math.max(...ys)
  const t0 = points[0].t, t1 = points[points.length - 1].t
  const x = p => (t1 === t0 ? W / 2 : 2 + (p.t - t0) / (t1 - t0) * (W - 4))
  const y = p => (hi === lo ? H / 2 : H - 3 - (p.y - lo) / (hi - lo) * (H - 6))
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(p).toFixed(1) + ' ' + y(p).toFixed(1)).join(' ')
  const last = points[points.length - 1]
  return <svg className="st-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={x(last)} cy={y(last)} r="2.5" fill="currentColor" />
  </svg>
}

export function deltaText(delta, unit) {
  const v = round(delta)
  if (v === 0) return '±0 ' + unit
  return (v > 0 ? '+' : '−') + fmtNum(Math.abs(v)) + ' ' + unit
}

export default function StrengthTrend({ S, onPick, now }) {
  const rows = useMemo(() => strengthTrend(S, now ? { now } : undefined), [S, now])
  if (!rows.length) return null
  return <div className="card strength-trend">
    <div className="lbl2">{t('Estimated 1RM')} · {t('Last 8 weeks')}</div>
    <h2>{t('Strength trend')}</h2>
    <div className="st-rows">{rows.map(r => {
      const ex = EXIDX[r.id]
      const dir = round(r.delta) > 0 ? 'up' : round(r.delta) < 0 ? 'down' : 'flat'
      return <div key={r.id} className={'st-row ' + dir} {...tappable(() => onPick && onPick(r.id))}>
        <span className={'st-n ' + exerciseNameClass(ex)}>{ex ? exerciseNameFor(ex) : r.id}</span>
        <Spark points={r.points} />
        <span className="st-v">{fmtNum(round(r.now))}<small> {S.unit}</small></span>
        <span className="st-d">{deltaText(r.delta, S.unit)}</span>
        <Icon name="chevronRight" />
      </div>
    })}</div>
  </div>
}
