// A typed number field, read the way the web's NumberField commits it (frontend/src/components/ui.jsx,
// nullable): a comma is the decimal point, only the first point counts, anything else that is not a
// digit drops out (so no sign), and a whole-number field counts only what is before a point. Empty
// reads as null. Pure.
export function parseNumberText(text, { decimal = true } = {}) {
  let s = String(text ?? '').replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const i = s.indexOf('.')
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
  const whole = !decimal && i !== -1 ? s.slice(0, i) : s
  return whole === '' || whole === '.' ? null : Math.max(0, parseFloat(whole))
}

// A number as the web's fmtNum shows it, in English: one decimal at most, thousands separators
// (format.js:58).
export const num = n => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 })

// What VoiceOver says for the unit after a number field (NumberRow).
export const SPOKEN_UNIT = { kcal: 'kilocalories', g: 'grams', in: 'inches', '%': 'percent' }

// A stored number as a field shows it to edit: as is, or empty for none.
export const numberText = n => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '')
