import { useEffect, useRef } from 'react'
import { FadeIn } from 'react-native-reanimated'
import { fadesIn } from './fade-in'
import { useMotion } from './use-motion'

// The `entering` prop for an Animated.View that is remounted (by `key`) when its content
// changes. Undefined unless a defined key changes (fadesIn), so opening the screen shows no fade.
// FadeIn defaults to ReduceMotion.System, and a zero duration covers the app's own reduce-motion
// flag. It only changes opacity; nothing waits on it.
export function useFadeIn(key, name = 'press') {
  const { duration } = useMotion()
  const previous = useRef(key)
  useEffect(() => { previous.current = key }, [key])
  return fadesIn(previous.current, key) ? FadeIn.duration(duration(name)) : undefined
}
