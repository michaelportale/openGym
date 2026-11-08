import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import IconButton from '../ui/IconButton'
import SetRow, { SetTableHeader } from './SetRow'

export default function ExerciseCard({ category, name, lastSession, sets, onAddSet, addSetHint }) {
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <AppText variant="label" color={color.textSecondary}>{category}</AppText>
        <AppText variant="title" accessibilityRole="header">{name}</AppText>
        <AppText variant="body" color={color.textSecondary}>{lastSession}</AppText>
      </View>
      <SetTableHeader />
      {sets.map(set => <SetRow key={set.number} {...set} />)}
      <View style={styles.addRow}>
        <IconButton symbol="plus" accessibilityLabel="Add set" accessibilityHint={addSetHint} onPress={onAddSet} />
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
