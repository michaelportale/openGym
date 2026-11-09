import { StyleSheet, View } from 'react-native'
import { color, radius, size, space, touch } from '../theme/tokens'
import NativeSymbol from '../ui/NativeSymbol'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import ScaleButton from '../ui/ScaleButton'
import { spokenUpNext } from './spoken'

// The exercise after the one on screen. Tapping it moves there, as the header's › does; the
// whole card shrinks while pressed.
export default function UpNextRow({ name, onPress }) {
  return (
    <ScaleButton accessibilityLabel={spokenUpNext(name)} accessibilityHint="Shows this exercise." onPress={onPress}>
      <Card style={styles.row}>
        <View style={styles.tile}>
          <NativeSymbol name="dumbbell" tintColor={color.textSecondary} size={size.icon} />
        </View>
        <View style={styles.text}>
          <AppText variant="label" color={color.textSecondary}>Up next</AppText>
          <AppText variant="heading">{name}</AppText>
        </View>
        <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
      </Card>
    </ScaleButton>
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
