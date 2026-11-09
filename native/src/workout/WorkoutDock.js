import { Pressable, StyleSheet, View } from 'react-native'
import { color, radius, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import GlassPanel from '../ui/GlassPanel'
import PrimaryButton from '../ui/PrimaryButton'
import RestPanel from './RestPanel'

const OPENS_KEYPAD = ['ready', 'enter-weight', 'enter-reps']

// Renders `workoutScreen(...).dock`. `inline` drops the pin so the dock can sit at the end of
// the scroll at large text sizes. The lead figure opens the keypad while a set is up.
// `children` sit under the primary button (the overnight prompt's other two choices).
export default function WorkoutDock({ dock, onLayout, inline, onPrimary, onPressLead, onAddTime, onSkip, busy, children }) {
  const tappable = OPENS_KEYPAD.includes(dock.mode)
  const lead = <AppText variant="lead" color={color.text}>{dock.lead}</AppText>
  return (
    <View onLayout={onLayout} style={inline ? null : styles.pinned}>
      <GlassPanel style={styles.panel}>
        {dock.mode === 'resting' ? (
          <RestPanel lead={dock.lead} sub={dock.sub} onAddTime={onAddTime} onSkip={onSkip} />
        ) : (
          <>
            {tappable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dock.lead}
                accessibilityHint="Opens the keypad to change the weight or reps."
                onPress={onPressLead}
              >
                {lead}
              </Pressable>
            ) : lead}
            <PrimaryButton label={dock.primaryLabel} disabled={busy} onPress={onPrimary} />
            {children}
          </>
        )}
      </GlassPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  pinned: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: {
    gap: space.md,
    padding: space.lg,
    borderTopColor: color.stroke,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg
  }
})
