import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, space, touch } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import IconButton from '../../ui/IconButton'
import LineChart from '../../ui/LineChart'
import ScaleButton from '../../ui/ScaleButton'
import ExerciseMedia from '../../exercises/ExerciseMedia'
import { exerciseDetail, findExercise } from '../../exercises/detail-view'
import { exerciseHistoryView } from '../../exercises/history-view'
import { routeId } from '../../exercises/route-id'
import { useExerciseSource } from '../../exercises/use-exercise-source'
import { loadExerciseText, exerciseTextLoaded } from '../../shared/exercise-text'
import { i18nCore } from '../../shared/training'
import WhySheet from '../../workout/WhySheet'
import { whyEntry } from '../../workout/why-entry'

const E1RM_WHY = whyEntry('e1rm-formula')

export default function ExerciseScreen() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const id = routeId(params.id)
  const { status, state, server, error } = useExerciseSource()
  const [textReady, setTextReady] = useState(exerciseTextLoaded)
  const [metric, setMetric] = useState('top')
  const [whyOpen, setWhyOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    loadExerciseText().then(ok => { if (mounted && ok) setTextReady(true) })
    return () => { mounted = false }
  }, [])

  const detail = useMemo(
    () => (status === 'ready' ? exerciseDetail({ state, id, server }) : null),
    [status, state, id, server]
  )
  const past = useMemo(
    () => (status === 'ready' && detail ? exerciseHistoryView(state, id, { metric }) : null),
    [status, detail, state, id, metric]
  )
  const ex = detail ? findExercise(state, id) : null
  // textReady is read so the text is looked up again once the packs are installed.
  const steps = ex && textReady ? i18nCore.instrFor(ex) || [] : []
  const desc = ex && textReady ? i18nCore.descFor(ex) || '' : ''

  const back = (
    <View style={styles.back}>
      <IconButton label="Back" accessibilityLabel="Back" onPress={() => router.back()} />
    </View>
  )
  const body = () => {
    if (status === 'loading') return null
    if (status === 'error') {
      return (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          {error?.message || 'Could not load this exercise.'}
        </AppText>
      )
    }
    if (!detail) {
      return (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          This exercise isn't in your library any more.
        </AppText>
      )
    }
    return (
      <>
        <AppText variant="title" accessibilityRole="header" style={styles.pad}>{detail.name}</AppText>
        {detail.tags.length > 0 ? (
          <AppText variant="label" color={color.textMuted} style={styles.pad}>{detail.tags.join(' · ')}</AppText>
        ) : null}
        {detail.media ? (
          <ExerciseMedia key={detail.media.clip} media={detail.media} style={styles.pad} />
        ) : null}
        {detail.custom ? <AppText variant="value" color={color.accent} style={styles.pad}>Yours</AppText> : null}
        {desc ? <AppText variant="body" color={color.textSecondary} style={styles.pad}>{desc}</AppText> : null}
        {detail.best || detail.last ? (
          <Card style={styles.history}>
            {detail.best ? <AppText variant="value">{detail.best}</AppText> : null}
            {detail.last ? <AppText variant="body" color={color.textSecondary}>{detail.last}</AppText> : null}
          </Card>
        ) : null}
        {past ? (
          <Card style={styles.past}>
            <AppText variant="heading" accessibilityRole="header">Your history</AppText>
            {past.canToggle ? (
              <View style={styles.toggleRow}>
                {[['top', 'Top set'], ['e1rm', 'Est. 1RM']].map(([key, text]) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: past.metric === key }}
                    accessibilityLabel={text}
                    onPress={() => setMetric(key)}
                    style={[styles.seg, past.metric === key && styles.segOn]}
                  >
                    <AppText variant="label" color={past.metric === key ? color.onAccent : color.text}>{text}</AppText>
                  </Pressable>
                ))}
                <ScaleButton accessibilityLabel="Why this? Est. 1RM" accessibilityHint="Shows how the estimated 1RM is worked out." onPress={() => setWhyOpen(true)} style={styles.why} faceStyle={styles.whyFace}>
                  <AppText variant="label" color={color.accent}>Why this?</AppText>
                </ScaleButton>
              </View>
            ) : null}
            {past.chart.points.length > 1 ? (
              <LineChart points={past.chart.points} label={`${detail.name}, ${past.metric === 'e1rm' ? 'Est. 1RM' : 'Top set'} over ${past.chart.points.length} sessions`} />
            ) : null}
            {past.sessions.map((s, i) => (
              <View key={`${s.d}-${i}`} style={styles.sessionRow}>
                <AppText variant="label" color={color.textMuted} style={styles.sessionDate}>{s.label}</AppText>
                <AppText variant="body" style={styles.sessionSets}>{s.sets}</AppText>
                {s.pr ? <AppText variant="label" color={color.accent}>PR</AppText> : null}
              </View>
            ))}
          </Card>
        ) : null}
        {steps.length > 0 ? (
          <View style={styles.pad}>
            <AppText variant="heading" accessibilityRole="header">How to</AppText>
            {steps.map((s, i) => (
              <AppText key={i} variant="body" style={styles.step}>{i + 1}. {s}</AppText>
            ))}
          </View>
        ) : textReady ? (
          <View style={styles.pad}>
            <AppText variant="heading" accessibilityRole="header">How to</AppText>
            <AppText variant="body" color={color.textSecondary} style={styles.step}>
              No steps written for this exercise yet.
            </AppText>
          </View>
        ) : null}
      </>
    )
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}
    >
      {back}
      {body()}
      <WhySheet visible={whyOpen} entry={E1RM_WHY} onClose={() => setWhyOpen(false)} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl * 2, gap: space.md },
  back: { paddingHorizontal: space.lg, alignItems: 'flex-start' },
  pad: { marginHorizontal: space.lg },
  history: { marginHorizontal: space.lg, padding: space.lg, gap: space.xs, borderRadius: radius.md },
  past: { marginHorizontal: space.lg, padding: space.lg, gap: space.md, borderRadius: radius.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  seg: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: color.control },
  segOn: { backgroundColor: color.accent },
  why: { minHeight: touch.min, justifyContent: 'center' },
  whyFace: { paddingHorizontal: space.sm },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // Sized to its text: 'Nov 9' fits 56 pt, a date from another year ('Nov 9, 2025') takes more.
  sessionDate: { minWidth: 56 },
  sessionSets: { flexShrink: 1, flexGrow: 1 },
  step: { marginTop: space.sm }
})
