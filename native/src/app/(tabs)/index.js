import { useEffect } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'
import { clearRestAlerts } from '../../notify/use-rest-alerts'
import { screenFrame } from '../../shell/tabs'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import PrimaryButton from '../../ui/PrimaryButton'
import ScreenHeader from '../../ui/ScreenHeader'
import StartScreen from '../../workout/StartScreen'
import { useWorkoutHome } from '../../workout/use-workout-home'
import WorkoutError from '../../workout/WorkoutError'
import WorkoutSession from '../../workout/WorkoutSession'

// The tab never passes for the owner's data while it runs on the example snapshot.
const EXAMPLE_NOTICE = 'Example data. Your routines are not loaded on this build.'

function Body({ home }) {
  if (home.status === 'session') {
    return (
      <WorkoutSession
        key={home.sessionId}
        db={home.db}
        base={home.base}
        openBase={home.openBase}
        state={home.state}
        names={home.snapshot.names ?? {}}
        onExit={home.reload}
      />
    )
  }
  if (home.status === 'start') {
    return (
      <StartScreen
        db={home.db}
        routines={home.state.routines ?? []}
        nextId={home.nextId}
        workoutCount={home.workouts.length}
        onStart={home.begin}
      />
    )
  }
  return (
    <View style={styles.fill}>
      <ScreenHeader title="Workout" />
      {home.status === 'error' ? (
        <View style={styles.body}>
          <Card accessibilityLiveRegion="polite" style={styles.card}>
            <AppText variant="body">{`Could not open the workout store: ${home.error?.message ?? 'unknown error'}`}</AppText>
          </Card>
          <PrimaryButton label="Retry" accessibilityHint="Tries to open the workout store again." onPress={home.reload} />
        </View>
      ) : null}
    </View>
  )
}

// Expo Router wraps this route in it: a render throw shows the error, Retry and Export.
export function ErrorBoundary({ error, retry }) {
  return <WorkoutError error={error} retry={retry} />
}

export default function Workout() {
  const home = useWorkoutHome()
  // No workout open: a rest alert left pending (a kill right after Finish or Discard) is cancelled.
  useEffect(() => {
    if (home.status === 'start') clearRestAlerts()
  }, [home.status])
  return (
    <SafeAreaView edges={{ top: true, bottom: true }} style={screenFrame(Platform.OS)}>
      {home.snapshot.example ? (
        <Card accessibilityRole="alert" style={styles.example}>
          <AppText variant="body" color={color.text}>{EXAMPLE_NOTICE}</AppText>
        </Card>
      ) : null}
      <Body home={home} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { gap: space.lg, paddingHorizontal: space.lg },
  card: { padding: space.md },
  example: { marginHorizontal: space.lg, marginTop: space.sm, marginBottom: space.sm, padding: space.md, backgroundColor: color.surfaceActive }
})
