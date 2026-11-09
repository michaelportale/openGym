import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { color, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import ScaleButton from '../ui/ScaleButton'
import WhySheet from './WhySheet'
import { whyEntry } from './why-entry'

const REST_WHY = whyEntry('rest')

// The resting dock: the countdown is the largest figure on the screen, "Next: ..." under it.
// `label` is the whole of it in words (spokenLead).
export default function RestPanel({ lead, sub, label, paused, onPause, onResume, onAddTime, onSkip }) {
  const [why, setWhy] = useState(false)
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
        {/* Quiet, same row: the dock keeps one height. A Modal takes no layout space. */}
        <ScaleButton accessibilityLabel="About rest times" accessibilityHint="Shows where this number comes from." onPress={() => setWhy(true)} style={styles.why} faceStyle={styles.whyFace}>
          <AppText variant="button" color={color.textSecondary}>About rest times</AppText>
        </ScaleButton>
      </View>
      <WhySheet visible={why} entry={REST_WHY} onClose={() => setWhy(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  figures: { flexShrink: 1 },
  controls: { flexDirection: 'row', gap: space.sm },
  why: { minWidth: touch.min, minHeight: touch.min },
  whyFace: { minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' }
})
