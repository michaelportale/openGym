import { useState } from 'react'
import { Pressable, Share, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import { exportPayload } from './export'

const NOTHING = 'Nothing to export yet'

// Shares every finished workout on the phone as JSON through the iOS share sheet, so the owner
// can AirDrop a backup. Reads the store at tap time; with nothing stored it says so instead of
// opening the sheet. `count` is how many the screen already knows of (0 shows the text alone).
export default function ExportButton({ db, count }) {
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  if (count === 0) {
    return <AppText variant="body" color={color.textSecondary}>{NOTHING}</AppText>
  }
  const press = async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const workouts = await createSqliteFinishedWorkouts(db).list()
      const text = exportPayload(workouts, { exportedAt: new Date().toISOString(), appVersion: Constants.expoConfig?.version })
      if (text == null) setMessage(NOTHING)
      else await Share.share({ message: text, title: 'openGym workouts' })
    } catch (error) {
      setMessage(`Export failed: ${error?.message || String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Export workouts"
        accessibilityHint="Shares every workout saved on this phone as text, for a backup."
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={press}
        style={styles.button}
      >
        <AppText variant="button">Export workouts</AppText>
      </Pressable>
      {message ? <AppText variant="body" color={color.textSecondary} accessibilityLiveRegion="polite">{message}</AppText> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  button: {
    minHeight: touch.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.control,
    borderColor: color.stroke,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md
  }
})
