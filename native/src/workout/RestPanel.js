import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'

// The resting dock: the countdown is the largest figure on the screen, "Next: ..." under it.
// `label` is the whole of it in words (spokenLead).
export default function RestPanel({ lead, sub, label, paused, onPause, onResume, onAddTime, onSkip }) {
  return (
    <View style={styles.row}>
      <View accessible accessibilityLabel={label} style={styles.figures}>
        <AppText variant="label" color={color.textSecondary}>Rest</AppText>
        <AppText variant="timer">{lead}</AppText>
        {sub ? <AppText variant="value" color={color.textSecondary}>{sub}</AppText> : null}
      </View>
      <View style={styles.controls}>
        {paused ? (
          <IconButton label="Resume" accessibilityLabel="Resume rest" accessibilityHint="Starts the rest counting down again." onPress={onResume} />
        ) : (
          <IconButton label="Pause" accessibilityLabel="Pause rest" accessibilityHint="Stops the countdown until you resume." onPress={onPause} />
        )}
        <IconButton label="+30s" accessibilityLabel="Add 30 seconds" accessibilityHint="Rests 30 seconds longer." onPress={onAddTime} />
        <IconButton label="Skip" accessibilityLabel="Skip rest" accessibilityHint="Ends the rest now." onPress={onSkip} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  figures: { flexShrink: 1 },
  controls: { flexDirection: 'row', gap: space.sm }
})
