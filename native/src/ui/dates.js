import { localDate } from '../session/timing.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'YYYY-MM-DD' -> 'Nov 9, 2026' (or 'Nov 9' with year: false), from the parts so no time zone can shift the day.
export function shortDate(d, { year = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  if (!m) return String(d || '')
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${year ? `, ${m[1]}` : ''}`
}

const pad = n => String(n).padStart(2, '0')

// The local calendar day of a time (ms), as 'YYYY-MM-DD'.
export function isoDay(ms) {
  const x = new Date(ms)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

// 'YYYY-MM-DD' moved by n days, worked at local noon so a daylight-saving change cannot shift the
// day. Null for what is not a real date.
export function addDays(d, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '')
  if (!m) return null
  const x = new Date(+m[1], +m[2] - 1, +m[3], 12)
  if (x.getFullYear() !== +m[1] || x.getMonth() !== +m[2] - 1 || x.getDate() !== +m[3]) return null
  x.setDate(x.getDate() + n)
  return isoDay(x.getTime())
}

// Today on this phone as 'YYYY-MM-DD', in the device's time zone, read when it is asked for (a tap
// just after midnight lands on the new day). `now` for a caller that has already read the clock.
export const todayIso = (now = Date.now()) => localDate(now, Intl.DateTimeFormat().resolvedOptions().timeZone)

// A day sheet's date a step of n days on, or null past today (the web's max today) or for a bad date.
export function stepDay(iso, n, today) {
  const next = addDays(iso, n)
  return next && next <= today ? next : null
}

// A sheet's day: the full date, marked when it is today.
export const sheetDate = (d, today) => (d === today ? `Today, ${shortDate(d)}` : shortDate(d))

// The short date for a list or an axis: 'Nov 9' this year, 'Nov 9, 2025' in any other (the local
// year of `now`), so a history that spans years never reads as one.
export function dayLabel(d, now = Date.now()) {
  const m = /^(\d{4})-/.exec(d || '')
  return shortDate(d, { year: !!m && +m[1] !== new Date(now).getFullYear() })
}
