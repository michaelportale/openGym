// Pure chart maths for LineChart. points / trend: [{ t: ms, y: number, d?: 'YYYY-MM-DD' }]
// sorted by t. Every number returned is finite, rounded to 0.1.

const r1 = (n) => Math.round(n * 10) / 10
const finite = (n, fallback) => (Number.isFinite(n) ? n : fallback)

function dateOf(p) {
  if (p.d) return p.d
  const ms = new Date(p.t)
  return Number.isNaN(ms.getTime()) ? '' : ms.toISOString().slice(0, 10)
}

export function chartModel({ points, trend = null, goal = null, width, height, pad = 8 }) {
  if (!Array.isArray(points) || points.length === 0) return null
  const pts = points.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y))
  if (pts.length === 0) return null
  const tr = Array.isArray(trend) ? trend.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.y)) : []
  const useTrend = tr.length > 0
  const hasGoal = Number.isFinite(goal)

  const ys = [...pts.map((p) => p.y), ...tr.map((p) => p.y)]
  if (hasGoal) ys.push(goal)
  let yMin = Math.min(...ys)
  let yMax = Math.max(...ys)
  if (yMax === yMin) {
    yMin -= 1
    yMax += 1
  }

  const w = finite(width, 0)
  const h = finite(height, 0)
  const xLo = pad
  const xHi = Math.max(pad, w - pad)
  const yTop = pad
  const yBot = Math.max(pad, h - pad)
  const tMin = pts[0].t
  const tSpan = pts[pts.length - 1].t - tMin
  const xOf = (t) => r1(tSpan > 0 ? xLo + ((t - tMin) / tSpan) * (xHi - xLo) : (xLo + xHi) / 2)
  const yOf = (y) => r1(yBot - ((y - yMin) / (yMax - yMin)) * (yBot - yTop))

  const dots = pts.map((p) => ({ x: xOf(p.t), y: yOf(p.y) }))
  const lineSrc = useTrend ? tr.map((p) => ({ x: xOf(p.t), y: yOf(p.y) })) : dots
  const line = lineSrc.length > 1 ? lineSrc.map((d) => `${d.x},${d.y}`).join(' ') : null

  return {
    dots,
    line,
    goalY: hasGoal ? yOf(goal) : null,
    yMin,
    yMax,
    xFirst: dateOf(pts[0]),
    xLast: dateOf(pts[pts.length - 1])
  }
}
