import { StyleSheet, View } from 'react-native'
import { color, radius } from '../theme/tokens'

export default function Card({ style, children }) {
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderColor: color.stroke,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md
  }
})
