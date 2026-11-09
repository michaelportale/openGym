import { useEffect, useState } from 'react'
import { Platform, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'
import { screenFrame } from '../shell/tabs'
import { openAppDatabase } from '../storage/database'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import PrimaryButton from '../ui/PrimaryButton'
import ExportButton from './ExportButton'

// What the Workout tab shows when it throws while drawing. In a Release build an uncaught render
// error would restart into the same error, on the phone that holds the only record, so this
// says what broke, offers Retry, and keeps Export reachable. It opens the store on its own: the
// screen that threw may never have handed one over.
export default function WorkoutError({ error, retry }) {
  const [store, setStore] = useState({ db: null, error: null })
  useEffect(() => {
    let live = true
    openAppDatabase().then(
      db => { if (live) setStore({ db, error: null }) },
      e => { if (live) setStore({ db: null, error: e?.message || String(e) }) }
    )
    return () => { live = false }
  }, [])
  return (
    <SafeAreaView edges={{ top: true, bottom: true }} style={screenFrame(Platform.OS)}>
      <ScrollView contentContainerStyle={styles.body}>
        <AppText variant="title" accessibilityRole="header">Workout</AppText>
        <Card accessibilityLiveRegion="polite" style={styles.card}>
          <AppText variant="body">{`The Workout screen hit an error: ${error?.message || 'unknown error'}`}</AppText>
          <AppText variant="body" color={color.textSecondary}>Sets already logged stay saved on this phone. Export keeps a copy of your finished workouts.</AppText>
        </Card>
        <PrimaryButton label="Retry" accessibilityHint="Opens the Workout tab again." onPress={retry} />
        {store.db ? (
          <ExportButton db={store.db} />
        ) : (
          <AppText variant="body" color={color.textSecondary} accessibilityLiveRegion="polite">
            {store.error ? `Export is not available: ${store.error}` : 'Opening the workout store'}
          </AppText>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.lg, padding: space.lg },
  card: { gap: space.sm, padding: space.md }
})
