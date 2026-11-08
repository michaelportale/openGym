import { StyleSheet, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { color, glass } from '../theme/tokens'
import { useAccessibilityFlag } from './use-accessibility-flag'

// The layers are siblings of the children, so flipping the setting never remounts them.
export default function GlassPanel({ style, children }) {
  const solid = useAccessibilityFlag('reduceTransparency')
  return (
    <View style={[styles.panel, solid && styles.solid, style]}>
      {solid ? null : <BlurView tint={glass.tint} intensity={glass.intensity} style={StyleSheet.absoluteFill} />}
      {solid ? null : <View style={[StyleSheet.absoluteFill, styles.fill]} />}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { overflow: 'hidden' },
  solid: { backgroundColor: color.surfaceActive },
  fill: { backgroundColor: glass.fill, opacity: glass.alpha }
})
