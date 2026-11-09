import { Pressable, StyleSheet, View } from 'react-native'
import { color, radius, size, space, touch } from '../theme/tokens'
import NativeSymbol from '../ui/NativeSymbol'
import AppText from '../ui/AppText'
import Card from '../ui/Card'

export function upNextAccessibilityLabel(name) {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('Up next needs a name')
  return `Up next, ${name}.`
}

// The exercise after the one on screen. Tapping it moves there, as the header's › does.
export default function UpNextRow({ name, onPress }) {
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={upNextAccessibilityLabel(name)}
        accessibilityHint="Shows this exercise."
        onPress={onPress}
        style={styles.row}
      >
        <View style={styles.tile}>
          <NativeSymbol name="dumbbell" tintColor={color.textSecondary} size={size.icon} />
        </View>
        <View style={styles.text}>
          <AppText variant="label" color={color.textSecondary}>Up next</AppText>
          <AppText variant="heading">{name}</AppText>
        </View>
        <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
      </Pressable>
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  tile: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.control,
    borderColor: color.stroke,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm
  },
  text: { flex: 1, gap: space.xs }
})
