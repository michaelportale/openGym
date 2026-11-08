// SF Symbol names used by this phase. Off iOS, expo-symbols ignores a string name.
const TEXT = Object.assign(Object.create(null), {
  ellipsis: '…',
  'pause.fill': 'II',
  plus: '+',
  'checkmark.circle.fill': '✓',
  square: '□',
  dumbbell: '●',
  'chevron.right': '›'
})

export function symbolPresentation(name, os) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Symbol name is required: ${name}`)
  }
  // iOS draws the SF Symbol itself. The text map is only the other platforms.
  if (os === 'ios') return { kind: 'sf-symbol', name }
  if (!Object.hasOwn(TEXT, name)) throw new Error(`No visible fallback for symbol: ${name}`)
  const text = TEXT[name]
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error(`No visible fallback for symbol: ${name}`)
  }
  return { kind: 'text', text }
}
