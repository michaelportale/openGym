// The id in /exercise/<id> arrives URI-encoded (and as an array if the route repeats it).
// A malformed escape keeps the raw text rather than throwing.
export function routeId(value) {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
