import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import IconButton from '../ui/IconButton'
import SetRow, { SetTableHeader } from './SetRow'

// Props come from `workoutScreen(...).card`. `onPressRow(setId, field)` opens the keypad.
export default function ExerciseCard({ name, category, noHistory, rows, weightTitle, onPressRow, onAddSet }) {
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        {category ? <AppText variant="label" color={color.textSecondary}>{category}</AppText> : null}
        <AppText variant="screenTitle" accessibilityRole="header">{name}</AppText>
        {noHistory ? <AppText variant="body" color={color.textSecondary}>No history yet</AppText> : null}
      </View>
      <SetTableHeader weightTitle={weightTitle} />
      {rows.map(row => <SetRow key={row.setId} {...row} onPress={onPressRow} />)}
      <View style={styles.addRow}>
        <IconButton
          symbol="plus"
          accessibilityLabel="Add set"
          accessibilityHint="Adds one more set to this exercise."
          onPress={onAddSet}
        />
        <AppText variant="body" color={color.textSecondary} accessibilityElementsHidden style={styles.addLabel}>
          Add set
        </AppText>
      </View>
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
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
    borderTopColor: color.stroke,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  addLabel: { flexShrink: 1 }
})
