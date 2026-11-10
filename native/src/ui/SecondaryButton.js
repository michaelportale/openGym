import { Pressable, StyleSheet } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from './AppText'

// The outlined full-width button the sheets put under their PrimaryButton (Cancel, Close), as
// SlotSheet and LogWeightSheet draw it. `accessibilityLabel` is what VoiceOver says when it differs.
export default function SecondaryButton({ label, accessibilityLabel, accessibilityHint, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <AppText variant="button" style={styles.centered}>{label}</AppText>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  secondary: {
    minHeight: touch.row,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.stroke,
    backgroundColor: color.surface
  },
  pressed: { backgroundColor: color.surfaceActive },
  disabled: { opacity: 0.5 },
  centered: { textAlign: 'center' }
})
