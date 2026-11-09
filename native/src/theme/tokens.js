export const color = {
  bg: '#161B20', surface: '#1C2229', surfaceActive: '#212A33', field: '#1B2025', control: '#252D34',
  stroke: '#343A41', strokeStrong: '#6C7784', track: '#323943',
  text: '#FFFFFF', textSecondary: '#C3CCD6', textMuted: '#A9B4C0',
  accent: '#9BDFFD', onAccent: '#0F1418'
}
export const glass = { fill: '#1C2229', alpha: 0.82, tint: 'dark', intensity: 40 }
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }
export const radius = { sm: 8, md: 12, lg: 16 }
export const touch = { min: 44, row: 48, primary: 56 }
export const type = {
  wordmark: { fontSize: 20, fontWeight: '400' },
  wordmarkStrong: { fontSize: 20, fontWeight: '700' },
  title: { fontSize: 28, fontWeight: '700' },
  timer: { fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
  value: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  lead: { fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  screenTitle: { fontSize: 20, fontWeight: '700' },
  button: { fontSize: 17, fontWeight: '700' }
}
// Dynamic Type caps (maxFontSizeMultiplier). The lead stops at 34 × 1.3 = 44.2 pt so the dock
// stays on screen, and no other style but the resting timer may outgrow it at any text size.
export const fontScale = {
  wordmark: 2.2, wordmarkStrong: 2.2, title: 1.5, timer: 1.3, value: 1.3, heading: 2.5,
  body: 2.9, label: 1.5, lead: 1.3, screenTitle: 1.5, button: 2.5
}
export const motion = { press: 120, progress: 300 }
export const pressScale = 0.97
export const size = { icon: 22, marker: 24, progress: 6, stroke: 1 }
