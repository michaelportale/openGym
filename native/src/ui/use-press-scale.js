import { useState } from 'react'
import { pressScale } from '../theme/tokens'
import { useMotion } from './use-motion'

// Spread the handlers on a Pressable and put the style on an inner Animated.View,
// so the hit area itself never shrinks. A zero duration makes Reanimated skip the transition.
export function usePressScale() {
  const { duration } = useMotion()
  const [pressed, setPressed] = useState(false)
  return {
    handlers: { onPressIn: () => setPressed(true), onPressOut: () => setPressed(false) },
    style: {
      transform: [{ scale: pressed ? pressScale : 1 }],
      transitionProperty: 'transform',
      transitionDuration: duration('press')
    }
  }
}
