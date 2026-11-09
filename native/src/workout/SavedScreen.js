import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { createSqliteFinishedWorkouts } from '../session/finished-workouts'
import { color, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import PrimaryButton from '../ui/PrimaryButton'
import ScaleButton from '../ui/ScaleButton'
import ScreenHeader from '../ui/ScreenHeader'
import ExportButton from './ExportButton'
import { savedNextTime } from './next-time'
import WhySheet from './WhySheet'
import { whyEntry } from './why-entry'

// The register entries a line can open: its own (whyId: progression or deload) and the effort note's.
const WHY_ENTRIES = [whyEntry('progression'), whyEntry('deload'), whyEntry('effort')]
const EFFORT_ID = whyEntry('effort').id

function WhyButton({ label, hint, onPress }) {
  return (
    <ScaleButton accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={styles.why} faceStyle={styles.whyFace}>
      <AppText variant="label" color={color.textSecondary}>Why?</AppText>
    </ScaleButton>
  )
}

// One exercise's suggestion (nextTimeLines): the line and the engine's reason, then the effort
// note when the sets had many reps left. Each Why opens its register entry; none writes.
function NextTimeLine({ line, onWhy }) {
  return (
    <View style={styles.line}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <AppText variant="body">{line.text}</AppText>
          {line.reason ? <AppText variant="label" color={color.textSecondary}>{line.reason}</AppText> : null}
        </View>
        <WhyButton label={`Why this suggestion for ${line.name}?`} hint="Shows how the next weight is decided." onPress={() => onWhy(line.whyId)} />
      </View>
      {line.effortNote ? (
        <View style={styles.row}>
          <AppText variant="body" color={color.textSecondary} style={styles.grow}>{line.effortNote}</AppText>
          <WhyButton label={`Why far from failure on ${line.name}?`} hint="Shows what reps left says about a set." onPress={() => onWhy(EFFORT_ID)} />
        </View>
      ) : null}
    </View>
  )
}

// After Finish. The phone holds the only copy until sync exists, so Export sits right here.
// "Next time" reads the phone's workouts, the one just saved among them, into the session's
// history; with no line to show (progression off, nothing weighted) it shows nothing.
export default function SavedScreen({ db, state, base, names, onDone }) {
  const [lines, setLines] = useState([])
  const [why, setWhy] = useState(null)

  // Read once: the session's state, base and names are fixed for its life (it is keyed by id).
  useEffect(() => {
    let live = true
    createSqliteFinishedWorkouts(db).list()
      .then(phoneWorkouts => {
        if (live) setLines(savedNextTime({ state, base, phoneWorkouts, names }))
      })
      // The workout is saved either way; only the suggestions are missing.
      .catch(error => console.warn('Next time suggestions not read:', error?.message ?? error))
    return () => { live = false }
  }, [db])

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <ScreenHeader title="Workout" />
      <View style={styles.body}>
        <Card accessibilityLiveRegion="polite" style={styles.card}>
          <AppText variant="heading">Saved on this phone. Not synced yet.</AppText>
        </Card>
        {lines.length ? (
          <Card style={[styles.card, styles.lines]}>
            {lines.map(line => <NextTimeLine key={line.exerciseId} line={line} onWhy={setWhy} />)}
          </Card>
        ) : null}
        <ExportButton db={db} />
        <PrimaryButton label="Done" accessibilityHint="Goes back to the start of the Workout tab." onPress={onDone} />
      </View>
      {WHY_ENTRIES.map(entry => <WhySheet key={entry.id} visible={why === entry.id} entry={entry} onClose={() => setWhy(null)} />)}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.xl },
  body: { gap: space.lg, paddingHorizontal: space.lg },
  card: { padding: space.lg },
  lines: { gap: space.lg },
  line: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1, gap: space.xs },
  why: { minWidth: touch.min, minHeight: touch.min },
  whyFace: { minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' }
})
