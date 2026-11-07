import { color } from '../theme/tokens.js'

// Fixed positions from the PRD. `availability` is the honesty flag for this phase.
export const TABS = [
  { name: 'index', label: 'Home', availability: 'unbuilt', sf: { default: 'house', selected: 'house.fill' } },
  { name: 'plan', label: 'Plan', availability: 'unbuilt', sf: { default: 'calendar', selected: 'calendar' } },
  {
    name: 'workout',
    label: 'Workout',
    availability: 'preview',
    sf: { default: 'dumbbell', selected: 'dumbbell.fill' },
    // The dock is pinned, so this screen applies its own safe-area insets.
    disableAutomaticContentInsets: true
  },
  { name: 'progress', label: 'Progress', availability: 'unbuilt', sf: { default: 'chart.bar', selected: 'chart.bar.fill' } },
  {
    name: 'exercises',
    label: 'Exercises',
    availability: 'unbuilt',
    sf: { default: 'square.stack.3d.up', selected: 'square.stack.3d.up.fill' }
  }
]

export function tabBarColors() {
  return {
    labelStyle: {
      default: { color: color.textSecondary },
      selected: { color: color.accent }
    },
    iconColor: {
      default: color.textSecondary,
      selected: color.accent
    },
    tintColor: color.accent
  }
}

// Liquid Glass recolours a tab item unless both appearances carry the same value.
// Other platforms keep the hex so preview does not call DynamicColorIOS.
export function pinnedTabColor(value, os, dynamicColor) {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new Error(`Tab colour must be a hex string: ${value}`)
  }
  if (os !== 'ios') return value
  if (typeof dynamicColor !== 'function') throw new Error('iOS tab colours need DynamicColorIOS')
  return dynamicColor({ dark: value, light: value })
}
