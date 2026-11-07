import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-screens/experimental'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import PrimaryButton from '../../ui/PrimaryButton'
import ProgressBar from '../../ui/ProgressBar'
import ScreenHeader from '../../ui/ScreenHeader'
import { dockFits } from '../../workout/dock-layout'
import ExerciseCard from '../../workout/ExerciseCard'
import { previewWorkout as preview } from '../../workout/preview-data'
import RestPanel from '../../workout/RestPanel'
import UpNextRow from '../../workout/UpNextRow'
import WorkoutDock from '../../workout/WorkoutDock'

const noop = () => {}

export default function Workout() {
  const [measured, setMeasured] = useState({ screen: 0, head: 0, dock: 0 })
  const measure = part => event => {
    const { height } = event.nativeEvent.layout
    setMeasured(current => (current[part] === height ? current : { ...current, [part]: height }))
  }
  const pinned = dockFits(measured)
  const dockHeight = pinned ? measured.dock : 0

  const head = (
    <View onLayout={measure('head')}>
      <ScreenHeader
        title={preview.routine}
        subtitle={`Exercise ${preview.exerciseNumber} of ${preview.exerciseCount}`}
      />
      <ProgressBar value={preview.exerciseNumber / preview.exerciseCount} style={styles.progress} />
      <Card style={styles.banner}>
        <AppText variant="body" color={color.textSecondary}>
          Preview with sample data. Buttons do nothing and nothing is saved.
        </AppText>
      </Card>
    </View>
  )
  const dock = (
    <WorkoutDock onLayout={measure('dock')} inline={!pinned}>
      <RestPanel
        remainingText={preview.rest.remainingText}
        progress={preview.rest.progress}
        onAddTime={noop}
        onPause={noop}
      />
      <PrimaryButton label="Complete set" onPress={noop} />
    </WorkoutDock>
  )

  return (
    <SafeAreaView edges={{ top: true, bottom: true }} onLayout={measure('screen')}>
      {pinned ? head : null}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: dockHeight }}
        scrollIndicatorInsets={{ bottom: dockHeight }}
      >
        {pinned ? null : head}
        <View style={styles.body}>
          <ExerciseCard {...preview.exercise} />
          <UpNextRow name={preview.upNext} />
        </View>
        {pinned ? null : dock}
      </ScrollView>
      {pinned ? dock : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  progress: { marginHorizontal: space.lg },
  banner: { margin: space.lg, marginBottom: space.md, padding: space.md },
  scroll: { flex: 1 },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg }
})
