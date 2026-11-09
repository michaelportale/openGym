import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { accessibilityFlag, flagMemory } from './accessibility-flag'

// Every hook's reads and change events land here, so a hook mounted later (a row that swapped its
// root, say) starts from the known value rather than the default.
const memory = flagMemory()

// Starts from the value already known; before any read has resolved, reduced only when the
// platform can answer, so a requested reduction is not shown early. A missing reader is left off
// and is not called.
export function useAccessibilityFlag(name) {
  const { read, event } = accessibilityFlag(name)
  const [enabled, setEnabled] = useState(() => memory.start(AccessibilityInfo, name))
  useEffect(() => {
    const readFlag = AccessibilityInfo[read]
    if (typeof readFlag !== 'function') return undefined
    let mounted = true
    const resolved = value => {
      memory.remember(name, value)
      if (mounted) setEnabled(Boolean(value))
    }
    Promise.resolve(readFlag.call(AccessibilityInfo)).then(resolved, () => {
      if (mounted) setEnabled(true)
    })
    const subscription = typeof AccessibilityInfo.addEventListener === 'function'
      ? AccessibilityInfo.addEventListener(event, resolved)
      : null
    return () => {
      mounted = false
      if (subscription && typeof subscription.remove === 'function') subscription.remove()
    }
  }, [event, read, name])
  return enabled
}
