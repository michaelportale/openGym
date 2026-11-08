import { StyleSheet, View } from 'react-native'
import { color, radius, space } from '../theme/tokens'
import GlassPanel from '../ui/GlassPanel'

// `inline` drops the pin so the dock can sit at the end of the scroll at large text sizes.
export default function WorkoutDock({ onLayout, inline, children }) {
  return (
    <View onLayout={onLayout} style={inline ? null : styles.pinned}>
      <GlassPanel style={styles.panel}>{children}</GlassPanel>
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
