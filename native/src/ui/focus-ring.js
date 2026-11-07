// Web keyboard focus only. Native keeps the system treatment, and the resting control is unchanged.
export function focusRingStyle(focused, os, accent) {
  if (!focused || os !== 'web') return null
  return { outlineStyle: 'solid', outlineWidth: 2, outlineColor: accent }
}
