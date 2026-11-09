import { useState } from 'react'
import { Platform, Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { color } from '../theme/tokens'
import { focusRingStyle } from './focus-ring'
import { usePressScale } from './use-press-scale'

// A button with PrimaryButton's press scale and focus ring. `style` places the hit area, which
// never shrinks; `faceStyle` draws the face inside it, which does. Other props go to the Pressable.
export default function ScaleButton({ style, faceStyle, children, ...rest }) {
  const press = usePressScale()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={style}
      {...press.handlers}
    >
      <Animated.View style={[faceStyle, focusRingStyle(focused, Platform.OS, color.accent), press.style]}>
        {children}
      </Animated.View>
    </Pressable>
  )
}
