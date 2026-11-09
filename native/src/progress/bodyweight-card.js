// The model behind the Progress tab's body-weight card. Pure; the screen renders it.
// `bodyweight` is the effective list (server copy or snapshot, with this phone's pending weigh-ins).
import { bwView, bwTrend } from '../shared/training.js'
import { dayLabel } from '../ui/dates.js'

const round1 = n => Math.round(n * 10) / 10
// One decimal, as the Today line shows it; a weight that is not a number shows as nothing.
const lb = w => (Number.isFinite(Number(w)) ? `${Number(w).toFixed(1)} lb` : '')
// Plus, the true minus (U+2212) or plus-minus, then the size; a change that rounds to nothing is ±0.
const signed = v => {
  const r = round1(Math.abs(v))
  return (r === 0 ? '±' : v > 0 ? '+' : '−') + r
}

export function bodyweightCard({ bodyweight, range, now, targetW = null }) {
  const list = Array.isArray(bodyweight) ? bodyweight : []
  const v = bwView.bodyweightView(list, { range, now, targetW })
  const need = bwTrend.BW_TREND_MIN - v.points.length
  const recent = list.slice(-7).reverse().map(e => ({
    d: e.d, label: dayLabel(e.d, now), weight: lb(e.w), health: e.src === 'health',
  }))
  return {
    averageLine: v.enough && v.trendNow ? `7-day average ${round1(v.trendNow.y)} lb` : null,
    weekLine: v.enough && v.week !== null ? `${signed(v.week)} lb this week` : null,
    monthLine: v.enough && v.delta30 !== null ? `${signed(v.delta30)} lb over 30 days` : null,
    towardLine: v.enough && v.toward ? 'toward your goal' : null,
    nudge: need > 0 ? `Log ${need} more weigh-in${need === 1 ? '' : 's'} to see a trend.` : null,
    // Under 3 weigh-ins the chart is dots only: a line through two of them would look like the
    // trend the card says it cannot draw yet.
    chart: v.points.length ? { points: v.points, trend: v.enough ? v.trend : null, goal: targetW ?? null, dotsOnly: !v.enough } : null,
    recent,
  }
}
