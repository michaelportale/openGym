import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { color, radius, size } from '../theme/tokens'
import { progressWidth } from './progress'
import { useMotion } from './use-motion'

export default function ProgressBar({ value, style }) {
  const { duration } = useMotion()
  return (
    <View style={[styles.track, style]}>
      <Animated.View
        style={[
          styles.fill,
          {
            width: progressWidth(value),
            transitionProperty: 'width',
            transitionDuration: duration('progress')
          }
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: size.progress,
    backgroundColor: color.track,
    borderRadius: radius.sm,
    overflow: 'hidden'
  },
  fill: { height: '100%', backgroundColor: color.accent, borderRadius: radius.sm }
})
