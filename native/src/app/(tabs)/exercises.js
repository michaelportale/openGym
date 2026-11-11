import { useCallback } from 'react'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { screenTopInset } from '../../shell/tabs'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Notices from '../../ui/Notices'
import ScreenHeader from '../../ui/ScreenHeader'
import TextButton from '../../ui/TextButton'
import { usePushLock } from '../../ui/use-push-lock'
import ExerciseList from '../../exercises/ExerciseList'
import { canAuthorCustom } from '../../exercises/exercise-notices'
import { useExerciseSource } from '../../exercises/use-exercise-source'

export default function Exercises() {
  const router = useRouter()
  const source = useExerciseSource()
  const guard = usePushLock()
  const onPick = useCallback(id => guard(() => router.push('/exercise/' + encodeURIComponent(id))), [guard, router])
  const ready = source.status === 'ready'
  const header = (
    <View>
      <ScreenHeader title="Exercises" />
      {ready ? (
        <>
          <Notices
            lines={(source.notices ?? []).map(n => ({ rid: n.key, text: n.text, dismissLabel: n.dismissLabel }))}
            onDismiss={source.dismiss}
          />
          <View style={styles.author}>
            {canAuthorCustom(source.copy) ? (
              <TextButton
                label="New exercise"
                accessibilityHint="Opens a form to add an exercise."
                onPress={() => guard(() => router.push('/custom-exercise'))}
              />
            ) : (
              <AppText variant="body" color={color.textSecondary}>Pair with your server to add or delete exercises.</AppText>
            )}
          </View>
        </>
      ) : null}
    </View>
  )

  if (source.status !== 'ready') {
    // Native tabs only inset the first ScrollView in a screen, so even the placeholder is one.
    return (
      <ScrollView
        style={styles.fill}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: screenTopInset(Platform.OS) }}
      >
        {header}
        <View style={styles.note}>
          <AppText variant="body" color={color.textSecondary}>
            {source.status === 'error' ? source.error?.message || 'Could not load your exercises.' : 'Loading…'}
          </AppText>
        </View>
      </ScrollView>
    )
  }
  return (
    <View style={[styles.fill, { paddingTop: screenTopInset(Platform.OS) }]}>
      <ExerciseList state={source.state} onPick={onPick} header={header} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  note: { paddingHorizontal: space.lg },
  author: { paddingHorizontal: space.lg, paddingBottom: space.sm }
})
