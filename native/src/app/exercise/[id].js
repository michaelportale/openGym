import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import IconButton from '../../ui/IconButton'
import ExerciseMedia from '../../exercises/ExerciseMedia'
import { exerciseDetail, findExercise } from '../../exercises/detail-view'
import { routeId } from '../../exercises/route-id'
import { useExerciseSource } from '../../exercises/use-exercise-source'
import { loadExerciseText, exerciseTextLoaded } from '../../shared/exercise-text'
import { i18nCore } from '../../shared/training'

export default function ExerciseScreen() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const id = routeId(params.id)
  const { status, state, server, error } = useExerciseSource()
  const [textReady, setTextReady] = useState(exerciseTextLoaded)

  useEffect(() => {
    let mounted = true
    loadExerciseText().then(ok => { if (mounted && ok) setTextReady(true) })
    return () => { mounted = false }
  }, [])

  const detail = useMemo(
    () => (status === 'ready' ? exerciseDetail({ state, id, server }) : null),
    [status, state, id, server]
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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl * 2, gap: space.md },
  back: { paddingHorizontal: space.lg, alignItems: 'flex-start' },
  pad: { marginHorizontal: space.lg },
  history: { marginHorizontal: space.lg, padding: space.lg, gap: space.xs, borderRadius: radius.md },
  step: { marginTop: space.sm }
})
