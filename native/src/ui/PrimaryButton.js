import { Pressable, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from './AppText'
import { usePressScale } from './use-press-scale'

export default function PrimaryButton({ label, onPress, disabled }) {
  const press = usePressScale()
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} {...press.handlers}>
      <Animated.View style={[styles.button, disabled && styles.disabled, press.style]}>
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
