import { StyleSheet, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from './AppText'
import ScaleButton from './ScaleButton'

// The day a sheet logs, a day at a time back or forward (the app has no date picker). VoiceOver
// reads it as one adjustable control named `label`: swipe up for the next day, down for the one
// before. `canBack` / `canForward` say whether a step that way is allowed; onStep(1 | -1).
export default function DayStepper({ label = 'Date', text, canBack = true, canForward, disabled, onStep }) {
  const back = !disabled && canBack
  const forward = !disabled && canForward
  const step = dir => {
    if (dir > 0 ? forward : back) onStep(dir)
  }
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={styles.stepper}
    >
      <AppText variant="body" style={styles.grow}>{label}</AppText>
      <View style={styles.controls}>
        <ScaleButton accessibilityLabel="Day before" disabled={!back} onPress={() => step(-1)} style={styles.hit} faceStyle={[styles.face, !back && styles.disabled]}>
          <AppText variant="value">‹</AppText>
        </ScaleButton>
        <AppText variant="value" style={styles.value}>{text}</AppText>
        <ScaleButton accessibilityLabel="Day after" disabled={!forward} onPress={() => step(1)} style={styles.hit} faceStyle={[styles.face, !forward && styles.disabled]}>
          <AppText variant="value">›</AppText>
        </ScaleButton>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  stepper: {
    minHeight: touch.row,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.surface
  },
  grow: { flexShrink: 1, flexGrow: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginLeft: 'auto' },
  hit: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  face: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: color.control },
  value: { textAlign: 'center' },
  disabled: { opacity: 0.5 }
})
