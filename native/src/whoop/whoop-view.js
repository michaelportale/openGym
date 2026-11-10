// The WHOOP card on Progress, as data: the state, today's lines, the 7-day recovery series and the
// recent cardio rows, from one GET /api/whoop read (api/openapi.yaml WhoopRead). Pure; the card
// renders it and use-whoop.js feeds it. A missing value shows a dash, never 0; a zero shows 0.
import { defaultDay, defaultTime } from '../sync/sync-status.js'
import { addDays, dayLabel, isoDay } from '../ui/dates.js'
import { num } from '../ui/number-text.js'

export const DASH = '–'

// What the card says. The first four, the button and the confirmation are the phase's exact copy.
export const WHOOP_TEXT = {
  unpaired: 'WHOOP shows here once this phone is paired with your server.',
  unconfigured: "WHOOP isn't set up on your server yet.",
  disconnected: 'Connect WHOOP to see recovery, strain and cardio here.',
  connect: 'Connect WHOOP',
  confirmTitle: 'Disconnect WHOOP?',
  confirmBody: 'Your server stops reading WHOOP and asks WHOOP to remove its access.',
  empty: 'Connected. Recovery, strain and cardio show here once WHOOP scores them.',
  unavailable: "Couldn't reach WHOOP. Try again later.",
  unreachable: "Couldn't reach your server. Try again later.",
  connectFailed: "Couldn't open WHOOP's sign-in. Try again.",
  disconnectFailed: "Couldn't disconnect WHOOP. Try again.",
  disconnectDone: 'WHOOP disconnected.',
  notRevoked: "WHOOP is disconnected here, but WHOOP couldn't be told. Remove openGym's access in the WHOOP app.",
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const has = v => typeof v === 'number' && Number.isFinite(v)
const whole = v => Math.round(v)
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

// Units: recovery %, HRV ms, resting HR bpm, strain 0–21 to one decimal, kcal rounded, whole minutes.
const pct = v => (has(v) ? `${whole(v)}%` : DASH)
const msText = v => (has(v) ? `${whole(v)} ms` : DASH)
const bpm = v => (has(v) ? `${whole(v)} bpm` : DASH)
const strainText = v => (has(v) ? v.toFixed(1) : DASH)
const kcalText = v => (has(v) ? `${num(whole(v))} kcal` : DASH)
const minText = v => (has(v) ? `${whole(v)} min` : DASH)

const noonOf = d => {
  const m = DAY_RE.exec(d)
  return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime()
}

function isRead(p) {
  return isObj(p) && typeof p.configured === 'boolean' && typeof p.connected === 'boolean' && Array.isArray(p.days) && Array.isArray(p.workouts)
}

const valued = day => has(day.recovery) || has(day.hrv) || has(day.rhr) || has(day.strain)

// What VoiceOver hears for one of today's lines; the dash is never read out.
const spoken = (label, v, words) => `${label}, ${has(v) ? words(v) : 'no reading'}`

function todayView(day, now) {
  const rec = pct(day.recovery)
  const calibrating = day.calibrating === true
  let recovery = { value: rec, a11y: spoken('Recovery', day.recovery, () => rec) }
  if (calibrating) {
    recovery = has(day.recovery)
      ? { value: `${rec} · calibrating`, a11y: `Recovery, ${rec}, calibrating` }
      : { value: 'Calibrating', a11y: 'Recovery, calibrating' }
  }
  return {
    d: day.d,
    title: day.d === isoDay(now) ? 'Today' : dayLabel(day.d, now),
    calibrating,
    recovery: rec,
    hrv: msText(day.hrv),
    rhr: bpm(day.rhr),
    strain: strainText(day.strain),
    rows: [
      { key: 'recovery', label: 'Recovery', ...recovery },
      { key: 'hrv', label: 'HRV', value: msText(day.hrv), a11y: spoken('HRV', day.hrv, v => `${whole(v)} milliseconds`) },
      { key: 'rhr', label: 'Resting HR', value: bpm(day.rhr), a11y: spoken('Resting heart rate', day.rhr, v => `${whole(v)} beats per minute`) },
      { key: 'strain', label: 'Strain', value: strainText(day.strain), a11y: spoken('Strain', day.strain, strainText) },
    ],
  }
}

/** One sentence for VoiceOver about the recovery chart; null with no points. */
export function recoveryChartLabel(series, { now = Date.now() } = {}) {
  if (!Array.isArray(series) || !series.length) return null
  const n = series.length
  const lead = n >= 7 ? 'Recovery for the last 7 days' : `Recovery for ${n} of the last 7 days`
  const last = series[n - 1]
  const latest = `${whole(last.y)}% on ${dayLabel(last.d, now)}`
  if (n === 1) return `${lead}: ${latest}.`
  const ys = series.map(p => p.y)
  return `${lead}: lowest ${whole(Math.min(...ys))}%, highest ${whole(Math.max(...ys))}%, latest ${latest}.`
}

const timeOf = w => {
  const t = typeof w.start === 'string' ? Date.parse(w.start) : NaN
  if (Number.isFinite(t)) return t
  return typeof w.d === 'string' && DAY_RE.test(w.d) ? noonOf(w.d) : -Infinity
}

const sportOf = s => (typeof s === 'string' && s.trim() ? s.trim()[0].toUpperCase() + s.trim().slice(1) : 'Workout')

// The newest 5 workouts, newest first. An unscored one keeps its sport, date and minutes.
function cardioRows(workouts, now) {
  const seen = new Map()
  return workouts
    .filter(isObj)
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, 5)
    .map(w => {
      const base = typeof w.start === 'string' && w.start ? w.start : String(w.d ?? '')
      const n = seen.get(base) ?? 0
      seen.set(base, n + 1)
      const sport = sportOf(w.sport)
      const date = typeof w.d === 'string' && DAY_RE.test(w.d) ? dayLabel(w.d, now) : DASH
      const minutes = minText(w.minutes)
      const strain = strainText(w.strain)
      const avgHr = bpm(w.avgHr)
      const kcal = kcalText(w.kcal)
      const spokenMinutes = has(w.minutes) ? `${whole(w.minutes)} ${whole(w.minutes) === 1 ? 'minute' : 'minutes'}` : 'duration not recorded'
      return {
        key: n ? `${base}#${n}` : base,
        sport,
        date,
        minutes,
        strain,
        avgHr,
        kcal,
        line: `${has(w.minutes) ? minutes : `${DASH} min`} · Strain ${strain} · Avg HR ${avgHr} · ${has(w.kcal) ? kcal : `${DASH} kcal`}`,
        a11y: [
          `${sport}, ${date === DASH ? 'no date' : date}: ${spokenMinutes}`,
          has(w.strain) ? `strain ${strain}` : 'strain not scored',
          has(w.avgHr) ? `average heart rate ${whole(w.avgHr)} beats per minute` : 'average heart rate not scored',
          has(w.kcal) ? `${num(whole(w.kcal))} kilocalories` : 'kilocalories not scored',
        ].join(', '),
      }
    })
}

function asOfLine(fetchedAt, now, formatTime, formatDay) {
  const at = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : NaN
  if (!Number.isFinite(at)) return null
  const time = formatTime(at)
  return formatDay(at) === formatDay(now) ? `As of ${time}` : `As of ${formatDay(at)}, ${time}`
}

const shell = (state, line, extra = {}) => ({
  state, line, error: null, connected: false, today: null, series: [], chartLabel: null, cardio: [], asOf: null, stale: false, ...extra,
})

/**
 * The card for one read. `payload` is the server's read (or the phone's cached copy of one, with
 * `cached`), or null when none could be had. state is unpaired | unconfigured | disconnected |
 * empty | ready; a connected card with nothing to show and an error is `empty` with `error` set,
 * and `line` is then the error. `connected` is when Disconnect shows. asOf is set when the read
 * is stale on the server or came from the phone's cache. Formatters are injectable for tests.
 */
export function whoopCardView(payload, { paired, now = Date.now(), cached = false, formatTime = defaultTime, formatDay = defaultDay } = {}) {
  if (!paired) return shell('unpaired', WHOOP_TEXT.unpaired)
  if (!isRead(payload)) return shell('empty', WHOOP_TEXT.unreachable, { error: WHOOP_TEXT.unreachable })
  if (!payload.configured) return shell('unconfigured', WHOOP_TEXT.unconfigured)
  if (!payload.connected) return shell('disconnected', WHOOP_TEXT.disconnected)

  // Newest first, whatever order they came in.
  const days = payload.days.filter(r => isObj(r) && typeof r.d === 'string' && DAY_RE.test(r.d)).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
  const day = days.find(valued) ?? null
  // The 7 days ending at the newest day sent, oldest first, each at local noon of its day.
  const from = days.length ? addDays(days[0].d, -6) : null
  const series = days
    .filter(r => r.d >= from && has(r.recovery))
    .map(r => ({ t: noonOf(r.d), y: r.recovery, d: r.d }))
    .reverse()
  const cardio = cardioRows(payload.workouts, now)
  const hasData = !!day || cardio.length > 0
  const error = !hasData && payload.error ? WHOOP_TEXT.unavailable : null
  const stale = payload.stale === true || cached === true
  return {
    state: hasData ? 'ready' : 'empty',
    line: hasData ? null : error || WHOOP_TEXT.empty,
    error,
    connected: true,
    today: day ? todayView(day, now) : null,
    series,
    chartLabel: recoveryChartLabel(series, { now }),
    cardio,
    asOf: stale ? asOfLine(payload.fetchedAt, now, formatTime, formatDay) : null,
    stale,
  }
}
