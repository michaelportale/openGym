import { expect, test } from 'vitest'
import { color, fontScale, glass, touch, type } from './tokens.js'

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const linear = v => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = hex => {
  const [r, g, b] = channels(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}
const over = (fg, alpha, bg) => {
  const mixed = channels(fg).map((v, i) => Math.round(alpha * v + (1 - alpha) * channels(bg)[i]))
  return '#' + mixed.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

test.each([
  ['text', 'bg'], ['text', 'surface'], ['text', 'surfaceActive'], ['text', 'field'], ['text', 'control'],
  ['textSecondary', 'bg'], ['textSecondary', 'surface'], ['textSecondary', 'surfaceActive'],
  ['textMuted', 'bg'], ['textMuted', 'surface'], ['textMuted', 'surfaceActive'], ['textMuted', 'control'],
  ['onAccent', 'accent'], ['accent', 'surface'], ['accent', 'surfaceActive']
])('%s on %s is readable as text', (fg, bg) => {
  expect(ratio(color[fg], color[bg])).toBeGreaterThanOrEqual(4.5)
})
test.each([
  ['strokeStrong', 'surface'], ['strokeStrong', 'surfaceActive'], ['strokeStrong', 'field'], ['accent', 'track']
])('%s on %s is visible as a control', (fg, bg) => {
  expect(ratio(color[fg], color[bg])).toBeGreaterThanOrEqual(3)
})
test.each(['text', 'textSecondary', 'textMuted', 'accent'])('%s stays readable on glass over the brightest content', fg => {
  const worstCase = over(glass.fill, glass.alpha, color.accent)
  expect(ratio(color[fg], worstCase)).toBeGreaterThanOrEqual(4.5)
})
test('primary and minimum touch targets are comfortable', () => {
  expect(touch.min).toBeGreaterThanOrEqual(44)
  expect(touch.primary).toBeGreaterThan(touch.min)
})
test('selected accent stays readable on the dark background', () => {
  expect(ratio(color.accent, color.bg)).toBeGreaterThanOrEqual(4.5)
})
test('text styles keep a size and a weight', () => {
  for (const style of Object.values(type)) {
    expect(style.fontSize).toBeGreaterThanOrEqual(11)
    expect(String(style.fontWeight)).toMatch(/^[1-9]00$/)
  }
})
test('dynamic type is capped where a row has to stay on screen', () => {
  expect(fontScale.value).toBeGreaterThan(1)
  expect(fontScale.timer).toBeGreaterThan(1)
  expect(fontScale.label).toBeGreaterThan(1)
  expect(fontScale.heading).toBeGreaterThanOrEqual(fontScale.label)
})
