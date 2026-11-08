export function progressWidth(value) {
  if (!Number.isFinite(value)) return '0%'
  return `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`
}
