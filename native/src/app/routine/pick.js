import { useCallback, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import IconButton from '../../ui/IconButton'
import ExerciseList from '../../exercises/ExerciseList'
import { routeId } from '../../exercises/route-id'
import { useExerciseSource } from '../../exercises/use-exercise-source'
import { deliverPick, endPick } from '../../plan/pick-relay'
import { UNSAFE_EDIT } from '../../plan/plan-view'

// The swap picker: the Exercises tab's list, pushed over a routine. A pick goes back to the
// routine screen through pick-relay.js (token in the route) and this screen closes, unless the
// swap would have to be made on the web: then it says so here and stays, so another exercise can
// be picked or Back taken. Back without a pick changes nothing.
export default function SwapPicker() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const token = routeId(params.token)
  const name = routeId(params.name)
  const source = useExerciseSource()
  const [message, setMessage] = useState(null)
  const done = useRef(false)

  const onPick = useCallback(id => {
    if (done.current) return
    if (deliverPick(token, id) === 'unsafe') {
      setMessage(UNSAFE_EDIT)
      return
    }
    done.current = true
    endPick(token)
    router.back()
  }, [token, router])

  // Above the list, not in it, so the refusal shows however far the list is scrolled.
  return (
    <View style={[styles.fill, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.top}>
        <View style={styles.back}>
          <IconButton label="Back" accessibilityLabel="Back" accessibilityHint="Returns to the routine without swapping." onPress={() => router.back()} />
        </View>
        <AppText variant="title" accessibilityRole="header">Swap exercise</AppText>
        {name ? <AppText variant="body" color={color.textSecondary}>{`Replacing ${name}`}</AppText> : null}
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</AppText>
        ) : null}
      </View>
      {source.status === 'ready' ? (
        <ExerciseList state={source.state} onPick={onPick} />
      ) : (
        <AppText variant="body" color={color.textSecondary} style={styles.note}>
          {source.status === 'error' ? source.error?.message || 'Could not load your exercises.' : 'Loading…'}
        </AppText>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  top: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.sm },
  back: { alignItems: 'flex-start' },
  note: { paddingHorizontal: space.lg }
})
