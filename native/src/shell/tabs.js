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
    tintColor: color.accent,
    backgroundColor: color.surface
  }
}

// Expo's web pill is fixed over the screen. Native tabs inset the screen themselves.
export function screenTopInset(os) {
  return os === 'web' ? 72 : 0
}

// The web column otherwise shrinks to the widest line and the phone width clips it.
export function screenFrame(os) {
  return { flex: 1, width: '100%', paddingTop: screenTopInset(os) }
}

export function tabLabelStyle(os) {
  const { labelStyle } = tabBarColors()
  const fit = os === 'web' ? { fontSize: 13 } : {}
  return {
    default: { ...labelStyle.default, ...fit },
    selected: { ...labelStyle.selected, ...fit }
  }
}

// The web pill's built-in padding hides the fifth label at phone width.
export const WEB_TAB_FIT = '[role="tablist"][aria-label="Main"] [role="tab"]{padding-left:8px;padding-right:8px}'

export function installWebTabFit(doc) {
  if (!doc?.head || typeof doc.createElement !== 'function' || typeof doc.getElementById !== 'function') return false
  if (doc.getElementById('opengym-web-tabs')) return false
  const style = doc.createElement('style')
  style.id = 'opengym-web-tabs'
  style.textContent = WEB_TAB_FIT
  doc.head.appendChild(style)
  return true
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
