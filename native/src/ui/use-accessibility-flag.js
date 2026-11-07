import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

const FLAGS = {
  reduceMotion: { read: 'isReduceMotionEnabled', event: 'reduceMotionChanged' },
  reduceTransparency: { read: 'isReduceTransparencyEnabled', event: 'reduceTransparencyChanged' }
}

// Starts on, so nobody who asked for less motion or transparency sees it while the OS answers.
export function useAccessibilityFlag(name) {
  if (!Object.hasOwn(FLAGS, name)) throw new Error(`Unknown accessibility flag: ${name}`)
  const [enabled, setEnabled] = useState(true)
  useEffect(() => {
    const { read, event } = FLAGS[name]
    let mounted = true
    AccessibilityInfo[read]().then(value => {
      if (mounted) setEnabled(value)
    })
    const subscription = AccessibilityInfo.addEventListener(event, setEnabled)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [name])
  return enabled
}
