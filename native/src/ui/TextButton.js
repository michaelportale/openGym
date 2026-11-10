import { StyleSheet } from 'react-native'
import { color, space, touch } from '../theme/tokens'
import AppText from './AppText'
import ScaleButton from './ScaleButton'

// A small accent-coloured word that acts (Dismiss, Edit, Clear), with the full 44-pt touch target
// around it, as the Plan notices' Dismiss is drawn. `accessibilityLabel` names what it acts on.
export default function TextButton({ label, accessibilityLabel, accessibilityHint, disabled, onPress }) {
  return (
    <ScaleButton
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={styles.hit}
      faceStyle={styles.face}
    >
      <AppText variant="label" color={disabled ? color.textMuted : color.accent}>{label}</AppText>
    </ScaleButton>
  )
}

const styles = StyleSheet.create({
  hit: { minHeight: touch.min, minWidth: touch.min, justifyContent: 'center' },
  face: { paddingHorizontal: space.sm, alignItems: 'center' }
})
