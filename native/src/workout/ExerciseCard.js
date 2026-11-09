import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import { poppedSetIds, statusBySetId } from '../ui/done-transition'
import IconButton from '../ui/IconButton'
import SetRow, { SetTableHeader } from './SetRow'

// An add control: a plus button with its words beside it (hidden from VoiceOver, which reads
// the button's own label).
function AddRow({ label, hint, onPress, style }) {
  return (
    <View style={[styles.addRow, style]}>
      <IconButton symbol="plus" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} />
      <AppText variant="body" color={color.textSecondary} accessibilityElementsHidden style={styles.addLabel}>
        {label}
      </AppText>
    </View>
  )
}

// Props come from `workoutScreen(...).card`. `onPressRow(setId, field)` opens the keypad. Warm-ups
// come before the work sets, so their add control sits above the table. `perHand` makes the rows
// say "each" after the weight.
export default function ExerciseCard({ name, category, noHistory, rows, weightTitle, perHand, onPressRow, onAddSet, onAddWarmup }) {
  // The last statuses shown; a remounted card (another exercise, a reopen) starts empty and pops nothing.
  const shown = useRef(null)
  const popped = poppedSetIds(shown.current, rows)
  useEffect(() => { shown.current = statusBySetId(rows) })
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        {category ? <AppText variant="label" color={color.textSecondary}>{category}</AppText> : null}
        <AppText variant="screenTitle" accessibilityRole="header">{name}</AppText>
        {noHistory ? <AppText variant="body" color={color.textSecondary}>No history yet</AppText> : null}
      </View>
      <AddRow label="Add warm-up" hint="Adds a warm-up set. Warm-ups do not count as sets." onPress={onAddWarmup} style={styles.addWarmup} />
      <SetTableHeader weightTitle={weightTitle} />
      {rows.map(row => <SetRow key={row.setId} {...row} pop={popped.has(row.setId)} perHand={perHand} onPress={onPressRow} />)}
      <AddRow label="Add set" hint="Adds one more set to this exercise." onPress={onAddSet} style={styles.addSet} />
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.sm },
  heading: {
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
    borderBottomColor: color.stroke,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm },
  addWarmup: { paddingVertical: space.sm },
  addSet: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopColor: color.stroke,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  addLabel: { flexShrink: 1 }
})
