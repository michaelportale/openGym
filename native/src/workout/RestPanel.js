import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'

// The resting dock: the countdown is the largest figure on the screen, "Next: ..." under it.
export default function RestPanel({ lead, sub, onAddTime, onSkip }) {
  return (
    <View style={styles.row}>
      <View accessible accessibilityLabel={`Rest, ${lead} left. ${sub}`} style={styles.figures}>
        <AppText variant="label" color={color.textSecondary}>Rest</AppText>
        <AppText variant="timer">{lead}</AppText>
        {sub ? <AppText variant="value" color={color.textSecondary}>{sub}</AppText> : null}
      </View>
      <View style={styles.controls}>
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
