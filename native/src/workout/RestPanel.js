import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import ProgressBar from '../ui/ProgressBar'

export default function RestPanel({ remainingText, progress, onAddTime, onPause, addTimeHint, pauseHint }) {
  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <View accessible>
          <AppText variant="label" color={color.textSecondary}>Rest</AppText>
          <AppText variant="timer">{remainingText}</AppText>
        </View>
        <View style={styles.controls}>
          <IconButton label="+30s" accessibilityLabel="Add 30 seconds" accessibilityHint={addTimeHint} onPress={onAddTime} />
          <IconButton symbol="pause.fill" accessibilityLabel="Pause rest" accessibilityHint={pauseHint} onPress={onPause} />
        </View>
      </View>
      <ProgressBar value={progress} />
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { gap: space.sm },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm
  },
  controls: { flexDirection: 'row', gap: space.sm }
})
