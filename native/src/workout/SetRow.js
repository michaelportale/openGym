import { StyleSheet, View } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import { setRowView } from './set-row-view'

const MARKERS = {
  checked: { name: 'checkmark.circle.fill', tint: color.accent, weight: 'regular' },
  open: { name: 'square', tint: color.accent, weight: 'semibold' },
  empty: { name: 'square', tint: color.strokeStrong, weight: 'regular' }
}

const COLUMN_TITLES = [['Set', 'number'], ['Lb', 'amount'], ['Reps', 'amount'], ['Done', 'done']]

// Lines up with SetRow's columns. Hidden from VoiceOver because each row says it all.
export function SetTableHeader() {
  return (
    <View accessibilityElementsHidden style={[styles.columns, styles.header]}>
      {COLUMN_TITLES.map(([title, column]) => (
        <AppText
          key={title}
          variant="label"
          color={color.textMuted}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles[column], styles.title]}
        >
          {title}
        </AppText>
      ))}
    </View>
  )
}

export default function SetRow({ number, weight, reps, status }) {
  const view = setRowView({ number, weight, reps, status })
  const boxed = view.fields === 'boxed'
  const marker = MARKERS[view.marker]
  const field = [styles.amount, boxed && styles.boxed]
  const amountColor = boxed ? color.text : color.textSecondary
  return (
    <View
      accessible
      accessibilityLabel={view.accessibilityLabel}
      style={[styles.columns, styles.row, boxed && styles.active]}
    >
      <View style={styles.number}>
        <AppText variant="value" color={boxed ? color.accent : color.textSecondary}>{number}</AppText>
      </View>
      <View style={field}>
        <AppText variant="value" color={amountColor}>{view.weightText}</AppText>
      </View>
      <View style={field}>
        <AppText variant="value" color={amountColor}>{view.repsText}</AppText>
      </View>
      <View style={[styles.done, styles.marker]}>
        <SymbolView name={marker.name} tintColor={marker.tint} weight={marker.weight} size={size.marker} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm },
  header: {
    paddingVertical: space.sm,
    borderBottomColor: color.stroke,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  title: { textAlign: 'center' },
  row: { minHeight: touch.min, borderRadius: radius.sm },
  active: { paddingVertical: space.sm, backgroundColor: color.surfaceActive },
  number: { flex: 1, alignItems: 'center' },
  amount: { flex: 2, alignItems: 'center', justifyContent: 'center' },
  boxed: {
    minHeight: touch.min,
    backgroundColor: color.field,
    borderColor: color.strokeStrong,
    borderWidth: size.stroke,
    borderRadius: radius.sm
  },
  done: { flex: 1, minWidth: touch.min },
  marker: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center' }
})
