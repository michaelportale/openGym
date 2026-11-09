import { useEffect, useRef, useState } from 'react'
import { AppState, ScrollView, StyleSheet, View } from 'react-native'
import { useRestAlerts } from '../notify/use-rest-alerts'
import { localDate } from '../session/timing'
import { useActiveSession } from '../session/use-active-session'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import IconButton from '../ui/IconButton'
import PrimaryButton from '../ui/PrimaryButton'
import ProgressBar from '../ui/ProgressBar'
import { dockFits } from './dock-layout'
import ExerciseCard from './ExerciseCard'
import { failureText } from './failure-text'
import FinishSheet from './FinishSheet'
import KeypadSheet from './KeypadSheet'
import SavedScreen from './SavedScreen'
import { finishSummary, lastTimesFor, liveView, withTargets } from './session-screen'
import UpNextRow from './UpNextRow'
import { useSessionActions } from './use-session-actions'
import { deviceTimeZone } from './use-workout-home'
import { currentExerciseIndex, workoutScreen } from './workout-view'
import WorkoutDock from './WorkoutDock'

const nameOf = (names, id) => names[id]?.name ?? `Unknown exercise (${id})`

// One session, keyed by its id. `openBase` is a new session's base (null restores the open
// journal); `base` is the session's base either way, read once for targets, title and last time.
export default function WorkoutSession({ db, base, openBase, state, names, onExit }) {
  const session = useActiveSession({ db, base: openBase, now: Date.now, timeZone: deviceTimeZone() })
  const [lastTimes] = useState(() => lastTimesFor(state, base))
  const [shownIndex, setShownIndex] = useState(null)
  const [now, setNow] = useState(Date.now)
  const [measured, setMeasured] = useState({ screen: 0, head: 0, dock: 0 })
  // When the engine last computed the view: the clock and the rest run on from there.
  const read = useRef({ view: null, at: 0 })
  if (read.current.view !== session.view) read.current = { view: session.view, at: Date.now() }

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const view = liveView(withTargets(session.view, base), read.current.at, Math.max(now, read.current.at))
  const count = view?.entries?.length ?? 0
  const index = shownIndex == null ? currentExerciseIndex(view) : Math.min(shownIndex, Math.max(0, count - 1))
  const screen = view ? workoutScreen(view, { names, lastTimes, exerciseIndex: index, title: base?.name }) : null
  const shownEntry = view?.entries?.[index] ?? null
  // The rest alert follows the journal: reconciled when the session opens or ends (saved,
  // discarded), on each return to the app, and after every write.
  const alerts = useRestAlerts({ session, sessionId: base?.id, names })
  const actions = useSessionActions({ session, base, restSec: state.restSec ?? 90, view, screen, shownEntry, setShownIndex, afterWrite: alerts })

  const restored = useRef(false)
  useEffect(() => {
    if (session.status !== 'loading') alerts()
    if (session.status !== 'ready' || restored.current) return
    restored.current = true
    if (view?.status === 'active') actions.restoreRest()
  }, [session.status])
  useEffect(() => {
    if (session.status === 'discarded') onExit()
  }, [session.status])
  // The engine reads the clock only when an action runs. Back from the background on a new
  // local day in the session's own zone (the one the engine decides overnight in), reopen (as
  // after a kill) so an overnight session asks before any set is logged.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      // The 1-second tick is suspended in the background: the first frame back reads the clock
      // now, so the rest and elapsed time are current rather than a tick behind.
      if (next === 'active') {
        setNow(Date.now())
        alerts()
      }
      const zone = read.current.view?.timeZone ?? deviceTimeZone()
      if (next === 'active' && read.current.view && localDate(Date.now(), zone) !== localDate(read.current.at, zone)) onExit()
    })
    return () => sub.remove()
  }, [])

  if (session.status === 'saved') return <SavedScreen db={db} onDone={onExit} />
  if (session.status === 'discarded') return null
  if (session.status !== 'ready' || !screen) {
    const failed = session.status === 'error'
    return (
      <View style={styles.message}>
        <AppText variant="body" color={color.textSecondary} accessibilityLiveRegion="polite">
          {failed ? failureText(session.error?.code, { action: 'open' }) : 'Opening workout'}
        </AppText>
        {failed ? <PrimaryButton label="Retry" accessibilityHint="Tries to open the workout again." onPress={onExit} /> : null}
      </View>
    )
  }

  const measure = part => event => {
    const { height } = event.nativeEvent.layout
    setMeasured(current => (current[part] === height ? current : { ...current, [part]: height }))
  }
  const pinned = dockFits(measured)
  const dockHeight = pinned ? measured.dock : 0
  const { header, card } = screen
  const overnight = view.disposition?.kind === 'overnight'
  // An overnight session ends at the engine's suggested end (its last logged work, or the time it
  // was offered when that work was under 20 minutes before); the engine refuses a finish without one.
  const finishEnd = overnight ? view.disposition.suggestedEnd ?? view.startedAt : null
  const upNext = view.entries[index + 1]
  const move = step => setShownIndex(Math.max(0, Math.min(count - 1, index + step)))
  const { sheet, finish } = actions

  const head = (
    <View onLayout={measure('head')} style={styles.head}>
      <View style={styles.titleRow}>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.grow}>{header.title}</AppText>
        <IconButton label="Finish" accessibilityLabel="Finish workout" accessibilityHint="Shows the summary before saving." onPress={() => finish.show(finishEnd)} />
      </View>
      <View style={styles.navRow}>
        <IconButton label="‹" accessibilityLabel="Previous exercise" accessibilityHint="Shows the exercise before this one." onPress={() => move(-1)} />
        <AppText variant="body" color={color.textSecondary} style={styles.grow}>
          {`Exercise ${header.exerciseNumber} of ${header.exerciseCount}`}
        </AppText>
        <AppText variant="value" color={color.textSecondary} accessibilityLabel={`Elapsed ${header.elapsedText}`}>{header.elapsedText}</AppText>
        <IconButton label="›" accessibilityLabel="Next exercise" accessibilityHint="Shows the exercise after this one." onPress={() => move(1)} />
      </View>
      <ProgressBar value={header.progress} />
      {actions.notice ? (
        <Card accessibilityLiveRegion="polite" style={styles.notice}>
          <AppText variant="body" accessibilityRole="alert">{actions.notice}</AppText>
        </Card>
      ) : null}
      {/* A set saved but its rest did not start: Start rest starts that same rest, through the gate. */}
      {actions.restNotice ? (
        <Card accessibilityLiveRegion="polite" style={[styles.notice, styles.restNotice]}>
          <AppText variant="body" accessibilityRole="alert">{actions.restNotice}</AppText>
          <View style={styles.restAction}>
            <IconButton label="Start rest" accessibilityLabel="Start rest" accessibilityHint="Starts the rest after your last set." onPress={actions.startRest} />
          </View>
        </Card>
      ) : null}
    </View>
  )

  // Overnight, the likely choice is to end last night's workout, so Finish is the filled button;
  // Resume and Discard sit under it. Its label claims no end time: the hint and the sheet say it.
  const dock = overnight ? (
    <WorkoutDock dock={{ mode: 'overnight', lead: 'Left open overnight', primaryLabel: 'Finish workout' }} onLayout={measure('dock')} inline={!pinned} onPrimary={() => finish.show(finishEnd)} busy={actions.busy}>
      <View style={styles.choices}>
        <IconButton label="Resume" accessibilityLabel="Resume workout" accessibilityHint="Keeps logging sets in this workout." onPress={actions.resume} />
        <IconButton label="Discard" accessibilityLabel="Discard workout" accessibilityHint="Asks before deleting this workout." onPress={actions.askDiscard} />
      </View>
    </WorkoutDock>
  ) : view.status === 'finished' ? (
    // Finished in the journal but not yet stored (a kill between the two): Save completes it.
    <WorkoutDock dock={{ mode: 'finished', lead: 'Not saved yet', primaryLabel: 'Save workout' }} onLayout={measure('dock')} inline={!pinned} onPrimary={() => finish.show(null)} busy={actions.busy} />
  ) : (
    <WorkoutDock dock={screen.dock} perHand={card.perHand} onLayout={measure('dock')} inline={!pinned} busy={actions.busy} {...actions.dock} />
  )

  return (
    <View style={styles.screen} onLayout={measure('screen')}>
      {pinned ? head : null}
      <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: dockHeight }} scrollIndicatorInsets={{ bottom: dockHeight }}>
        {pinned ? null : head}
        <View style={styles.body}>
          <ExerciseCard {...card} onPressRow={actions.openSheet} onAddSet={actions.addSet} onAddWarmup={actions.addWarmup} />
          {upNext ? <UpNextRow name={nameOf(names, upNext.id)} onPress={() => move(1)} /> : null}
        </View>
        {pinned ? null : dock}
      </ScrollView>
      {pinned ? dock : null}
      <KeypadSheet
        key={sheet.key ?? 0}
        visible={sheet.open}
        title={sheet.title ?? ''}
        initial={sheet.initial}
        perSide={sheet.perSide}
        side={sheet.side}
        initialField={sheet.initialField}
        weightSetWith={sheet.weightSetWith}
        weightTitle={card.weightTitle}
        perHand={card.perHand}
        saveLabel={sheet.mode === 'done' ? 'Update' : 'Save'}
        completeLabel={sheet.completeButton?.label}
        completeSpoken={sheet.completeButton?.spoken}
        notice={sheet.notice}
        onSave={sheet.onSave}
        onComplete={sheet.mode === 'current' ? sheet.onComplete : undefined}
        onUndo={sheet.mode === 'done' ? sheet.onUndo : undefined}
        onRemove={sheet.removable ? sheet.onRemove : undefined}
        onClose={sheet.onClose}
        onAppState={sheet.onAppState}
      />
      <FinishSheet
        visible={finish.open}
        title={base?.name ?? 'workout'}
        summary={finish.open ? finishSummary(view) : null}
        endsAtSuggestedEnd={finish.endsAtSuggestedEnd}
        notice={finish.notice}
        busy={actions.busy}
        onConfirm={finish.confirm}
        onDiscard={actions.askDiscard}
        onClose={finish.close}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1 },
  message: { flex: 1, gap: space.lg, padding: space.lg, justifyContent: 'center' },
  head: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  notice: { padding: space.md },
  restNotice: { gap: space.sm },
  restAction: { alignSelf: 'flex-start' },
  choices: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  body: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg }
})
