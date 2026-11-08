import { useState } from 'react'
import { Platform, Pressable, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from './AppText'
import { focusRingStyle } from './focus-ring'
import { usePressScale } from './use-press-scale'

export default function PrimaryButton({ label, onPress, disabled, accessibilityHint }) {
  const press = usePressScale()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...press.handlers}
    >
      <Animated.View style={[styles.button, disabled && styles.disabled, focusRingStyle(focused, Platform.OS, color.accent), press.style]}>
        <AppText variant="button" color={disabled ? color.textMuted : color.onAccent} style={styles.label}>
          {label}
        </AppText>
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: touch.primary,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent,
    borderRadius: radius.md
  },
  disabled: { backgroundColor: color.control },
  label: { textAlign: 'center' }
})
