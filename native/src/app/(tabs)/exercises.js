import { useCallback, useRef } from 'react'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { screenTopInset } from '../../shell/tabs'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import ScreenHeader from '../../ui/ScreenHeader'
import ExerciseList from '../../exercises/ExerciseList'
import { useExerciseSource } from '../../exercises/use-exercise-source'

export default function Exercises() {
  const router = useRouter()
  const source = useExerciseSource()
  // A second tap while the first push is still animating would stack another screen, so taps are
  // ignored until the tab is focused again (or a second has passed, in case the push never lands).
  const pushing = useRef(false)
  useFocusEffect(useCallback(() => { pushing.current = false }, []))
  const onPick = useCallback(id => {
    if (pushing.current) return
    pushing.current = true
    setTimeout(() => { pushing.current = false }, 1000)
    router.push('/exercise/' + encodeURIComponent(id))
  }, [router])
  const header = <ScreenHeader title="Exercises" />

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
  note: { paddingHorizontal: space.lg }
})
