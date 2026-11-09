import { StyleSheet, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import GlassPanel from '../ui/GlassPanel'
import PrimaryButton from '../ui/PrimaryButton'
import ScaleButton from '../ui/ScaleButton'
import RestPanel from './RestPanel'
import { spokenLead, spokenPrimaryHint } from './spoken'

const OPENS_KEYPAD = ['ready', 'enter-weight', 'enter-reps']

// Renders `workoutScreen(...).dock`. `inline` drops the pin so the dock can sit at the end of
// the scroll at large text sizes. The lead figure is a button that opens the keypad while a set
// is up, and plain text otherwise. `perHand` makes the spoken lead say "each" after the weight.
// `children` sit under the primary button (the overnight prompt's other two choices).
export default function WorkoutDock({ dock, perHand, onLayout, inline, onPrimary, onPressLead, onPause, onResume, onAddTime, onSkip, busy, children }) {
  const tappable = OPENS_KEYPAD.includes(dock.mode)
  const spoken = spokenLead(dock, { perHand })
  return (
    <View onLayout={onLayout} style={inline ? null : styles.pinned}>
      <GlassPanel style={styles.panel}>
        {dock.mode === 'resting' ? (
          <RestPanel lead={dock.lead} sub={dock.sub} label={spoken} paused={dock.paused} onPause={onPause} onResume={onResume} onAddTime={onAddTime} onSkip={onSkip} />
        ) : (
          <>
            {tappable ? (
              <ScaleButton
                accessibilityLabel={spoken}
                accessibilityHint="Opens the keypad to change the weight or reps."
                onPress={onPressLead}
                faceStyle={styles.lead}
              >
                <AppText variant="lead" color={color.text}>{dock.lead}</AppText>
              </ScaleButton>
            ) : (
              <AppText variant="lead" color={color.text} accessibilityLabel={spoken}>{dock.lead}</AppText>
            )}
            <PrimaryButton label={dock.primaryLabel} disabled={busy} accessibilityHint={spokenPrimaryHint(dock.mode, { side: dock.side })} onPress={onPrimary} />
            {children}
          </>
        )}
      </GlassPanel>
    </View>
  )
}

const styles = StyleSheet.create({
  lead: { minHeight: touch.min, justifyContent: 'center' },
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
