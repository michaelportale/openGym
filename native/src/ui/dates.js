const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'YYYY-MM-DD' -> 'Nov 9, 2026' (or 'Nov 9' with year: false), from the parts so no time zone can shift the day.
export function shortDate(d, { year = true } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  if (!m) return String(d || '')
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${year ? `, ${m[1]}` : ''}`
}
