import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import NativeSymbol from '../ui/NativeSymbol'
import PrimaryButton from '../ui/PrimaryButton'
import ScreenHeader from '../ui/ScreenHeader'
import ExportButton from './ExportButton'

// No session open: the next routine in the rotation first, then every routine, then Export.
export default function StartScreen({ db, routines, nextId, workoutCount, onStart }) {
  const next = routines.find(routine => routine.id === nextId)
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <ScreenHeader title="Workout" />
      <View style={styles.body}>
        {next ? (
          <PrimaryButton label={`Next: ${next.name}`} accessibilityHint="Starts this workout." onPress={() => onStart(next.id)} />
        ) : null}
        {routines.length ? (
          <Card>
            {routines.map((routine, index) => (
              <Pressable
                key={routine.id}
                accessibilityRole="button"
                accessibilityLabel={routine.name}
                accessibilityHint="Starts this workout."
                onPress={() => onStart(routine.id)}
                style={[styles.row, index > 0 && styles.divided]}
              >
                <AppText variant="heading" style={styles.name}>{routine.name}</AppText>
                <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
              </Pressable>
            ))}
          </Card>
        ) : (
          <AppText variant="body" color={color.textSecondary}>No routines in this build.</AppText>
        )}
        <ExportButton db={db} count={workoutCount} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.xl },
  body: { gap: space.lg, paddingHorizontal: space.lg },
  row: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md },
  divided: { borderTopColor: color.stroke, borderTopWidth: StyleSheet.hairlineWidth },
  name: { flex: 1 }
})
