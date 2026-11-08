import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { accessibilityFlag, accessibilityFlagDefault } from './accessibility-flag'

// Starts reduced only when the platform can answer, so a requested reduction is
// not shown early. A missing reader is left off and is not called.
export function useAccessibilityFlag(name) {
  const { read, event } = accessibilityFlag(name)
  const [enabled, setEnabled] = useState(() => accessibilityFlagDefault(AccessibilityInfo, name))
  useEffect(() => {
    const readFlag = AccessibilityInfo[read]
    if (typeof readFlag !== 'function') return undefined
    let mounted = true
    Promise.resolve(readFlag.call(AccessibilityInfo)).then(value => {
      if (mounted) setEnabled(Boolean(value))
    }, () => {
      if (mounted) setEnabled(true)
    })
    const subscription = typeof AccessibilityInfo.addEventListener === 'function'
      ? AccessibilityInfo.addEventListener(event, value => {
        if (mounted) setEnabled(Boolean(value))
      })
      : null
    return () => {
      mounted = false
      if (subscription && typeof subscription.remove === 'function') subscription.remove()
    }
  }, [event, read])
  return enabled
}
