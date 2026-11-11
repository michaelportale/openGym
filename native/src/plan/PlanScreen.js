import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { screenTopInset } from '../shell/tabs'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import NativeSymbol from '../ui/NativeSymbol'
import Notices from '../ui/Notices'
import ScaleButton from '../ui/ScaleButton'
import ScreenHeader from '../ui/ScreenHeader'
import TextButton from '../ui/TextButton'
import { SAVE_FAILED } from '../ui/messages'
import { usePushLock } from '../ui/use-push-lock'
import { queue, rotation } from '../shared/training.js'
import { nextRoutineId } from '../workout/next-up'
import { announce } from './announce'
import { NAME_BLANK, PAIR_TO_AUTHOR, movedText, orderMoved, planView, schedulePlan } from './plan-view'
import { newRoutine } from './routine-edit'
import { loopEdited, setDate, setWeekday, startOver, switchToRotation, switchToWeek } from './schedule-edit'
import { usePlan } from './use-plan'

const exercises = n => (n === 1 ? '1 exercise' : `${n} exercises`)
const loopIds = state => queue.queueOf(state)?.ids ?? rotation.rotationIds(state)
const loopLabel = state => queue.queueOf(state)?.label || state?.rotation?.label || ''
const dayLabel = day => `${day.label} ${day.names ? day.names.join(' + ') : 'Rest'}`
const dateLabel = date => `${date.label}, ${date.name ?? 'As planned'}`

function Schedule({ schedule }) {
  if (!schedule) return null
  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">How you train</AppText>
      <AppText variant="label" color={color.textMuted}>{schedule.kind === 'rotation' ? 'Rotation' : 'Fixed week'}</AppText>
      {schedule.kind === 'rotation'
        ? schedule.items.map((item, i) => (
          <View key={item.id} accessible accessibilityLabel={`${i + 1}. ${item.name}${item.next ? ', next' : ''}`} style={styles.line}>
            <AppText variant="value" color={color.textMuted} style={styles.order}>{i + 1}</AppText>
            <AppText variant="body" style={styles.grow}>{item.name}</AppText>
            {item.next ? <AppText variant="label" color={color.accent} style={styles.tag}>Next</AppText> : null}
          </View>
        ))
        : schedule.days.map(day => (
          <AppText key={day.label} variant="body" color={day.names ? color.text : color.textSecondary}>
            {`${day.label} · ${day.names ? day.names.join(' + ') : 'Rest'}`}
          </AppText>
        ))}
    </Card>
  )
}

function LoopRows({ items, onRemove }) {
  return items.map((item, i) => (
    <View key={item.id} style={styles.line}>
      <AppText variant="value" color={color.textMuted} style={styles.order}>{i + 1}</AppText>
      <AppText variant="body" style={styles.grow}>{item.name}</AppText>
      {item.next ? <AppText variant="label" color={color.accent} style={styles.tag}>Next</AppText> : null}
      {onRemove ? <TextButton label={`Remove ${item.name}`} onPress={() => onRemove(item.id)} /> : null}
    </View>
  ))
}

// The schedule card once a server copy is held. Unpaired, the screen keeps the read-only Schedule
// above and does not repeat PAIR_TO_AUTHOR. An external queue is shown, not edited.
function ScheduleEditor({ state, view, days, onFixedWeek, onRotation, onDay, onAdd, onRemove, onStartOver, onStart, onDiscard }) {
  const external = rotation.isExternalQueue(state)
  const recovery = rotation.queueRecovery(state)
  const mode = rotation.scheduleModeOf(state)
  const live = queue.queueOf(state) != null
  const items = view.schedule?.kind === 'rotation' ? view.schedule.items : []
  const canStart = !external && !live && !recovery && rotation.rotationIds(state).length > 0
  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">How you train</AppText>
      {external ? (
        <AppText variant="label" color={color.textMuted}>Externally managed</AppText>
      ) : (
        <View style={styles.modes}>
          <TextButton label="Fixed Week" accessibilityLabel="Fixed week" onPress={onFixedWeek} />
          <TextButton label="Rotation" accessibilityLabel="Rotation" onPress={onRotation} />
        </View>
      )}
      {recovery ? (
        <>
          <AppText variant="body" color={color.textSecondary}>This rotation couldn't be read. Another device may have written it.</AppText>
          <TextButton label="Discard it" onPress={onDiscard} />
        </>
      ) : null}
      {mode === 'week' && !external ? days.map(day => (
        <Pressable
          key={day.day}
          accessibilityRole="button"
          accessibilityLabel={dayLabel(day)}
          onPress={() => onDay(day)}
          style={({ pressed }) => [styles.dayHit, pressed && styles.pressed]}
        >
          <AppText variant="body" color={day.names ? color.text : color.textSecondary}>
            {`${day.label} · ${day.names ? day.names.join(' + ') : 'Rest'}`}
          </AppText>
        </Pressable>
      )) : null}
      {mode === 'rotation' ? (
        <>
          <LoopRows items={items} onRemove={external ? null : onRemove} />
          {external ? null : (
            <View style={styles.modes}>
              <TextButton label="Add to the rotation" onPress={onAdd} />
              {live ? <TextButton label="Start the loop over" onPress={onStartOver} /> : null}
              {canStart ? <TextButton label="Start the loop" onPress={onStart} /> : null}
            </View>
          )}
        </>
      ) : null}
    </Card>
  )
}

function DatesCard({ dates, onDate }) {
  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">The next 14 days</AppText>
      {dates.map(date => (
        <Pressable
          key={date.iso}
          accessibilityRole="button"
          accessibilityLabel={dateLabel(date)}
          onPress={() => onDate(date)}
          style={({ pressed }) => [styles.dayHit, pressed && styles.pressed]}
        >
          <AppText variant="body" color={date.name ? color.text : color.textSecondary}>
            {`${date.label} · ${date.name ?? 'As planned'}`}
          </AppText>
        </Pressable>
      ))}
    </Card>
  )
}

// The routine screen's Move up / Move down, for a routine row.
function MoveButton({ label, hint, glyph, disabled, onPress }) {
  return (
    <ScaleButton
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.moveHit}
      faceStyle={styles.moveFace}
    >
      <AppText variant="value" color={disabled ? color.textMuted : color.text}>{glyph}</AppText>
    </ScaleButton>
  )
}

// The Plan tab: notices of edits that were not sent, how you train, then every routine. A routine
// opens its own screen. With a server copy held, New routine adds one (named first, then opened),
// each row has Move up and Move down, and the schedule can be edited. Without one, a sentence says
// to pair instead (planView canAuthor). That sentence stays on the routines card.
export default function PlanScreen() {
  const router = useRouter()
  const guard = usePushLock()
  const plan = usePlan()
  const ready = plan.status === 'ready'
  // The replay behind next-up runs once per state, not per render.
  const nextId = useMemo(() => (ready ? nextRoutineId(plan.state, Date.now()) : null), [ready, plan.state])
  const view = useMemo(
    () => (ready ? planView(plan.state, { nextId, notices: plan.notices, copy: plan.copy }) : null),
    [ready, plan.state, plan.notices, plan.copy, nextId]
  )
  const editor = useMemo(
    () => (ready && view?.canEditSchedule ? schedulePlan(plan.state, Date.now()) : null),
    [ready, view, plan.state]
  )
  // Each row's key (its routine's id, and which of that id it is), so a moved row keeps its
  // VoiceOver focus, and whether Move up / Move down would move it.
  const rows = useMemo(() => {
    const seen = new Map()
    return (view?.routines ?? []).map(r => {
      const n = seen.get(r.id) ?? 0
      seen.set(r.id, n + 1)
      return { key: `${r.id}#${n}`, up: !!orderMoved(view.routines, r.id, -1), down: !!orderMoved(view.routines, r.id, 1) }
    })
  }, [view])
  // Read when a tap lands or the name prompt answers, not when the handler was made.
  const live = useRef(null)
  live.current = { view, copy: plan.copy, state: plan.state, sessionOpen: plan.sessionOpen === true }

  // A refusal or a failed save, shown until the next action, and said to VoiceOver (announce).
  const [message, setMessage] = useState(null)
  const say = text => {
    setMessage(text)
    announce(text)
  }

  // One move or schedule save at a time, each built on what is on screen: a tap is ignored while
  // one saves, and until the screen has rendered what it saved (the lock opens in an effect after
  // the render that follows the save; usePlan's reload is done by then). A helper that returns
  // null does not save, and the same effect clears the lock.
  const lock = useRef(false)
  const [moves, setMoves] = useState(0)
  useEffect(() => { lock.current = false }, [moves])
  const onMove = async (id, name, dir) => {
    const { view: now, copy } = live.current
    if (lock.current || !now?.canAuthor) return
    const ids = orderMoved(now.routines, id, dir)
    if (!ids) return
    const from = ids.indexOf(id) - dir
    lock.current = true
    setMessage(null)
    const result = await plan.reorder(ids, copy)
    setMoves(n => n + 1)
    if (result.ok) announce(movedText(name, from, from + dir, ids.length))
    else say(SAVE_FAILED)
  }

  // A schedule save. The screen passes the copy it is showing. Nothing extra is said when it lands.
  const commit = async (value) => {
    if (lock.current || !live.current.view?.canEditSchedule) return
    lock.current = true
    setMessage(null)
    if (value == null) {
      setMoves(n => n + 1)
      return
    }
    const result = await plan.schedule(value, live.current.copy)
    setMoves(n => n + 1)
    if (!result.ok) say(SAVE_FAILED)
  }
  const onRotation = () => {
    if (lock.current) return
    const state = live.current.state
    if (rotation.scheduleModeOf(state) === 'rotation') return
    commit(switchToRotation(state, Date.now()))
  }
  const onFixedWeek = () => {
    if (lock.current) return
    const state = live.current.state
    if (rotation.scheduleModeOf(state) === 'week') return
    if (!queue.queueOf(state)) {
      commit(switchToWeek(state, Date.now()))
      return
    }
    Alert.alert(
      'Back to a fixed week?',
      'The loop stops. Your weekdays stay as they are, and the loop is saved for later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use Fixed Week', onPress: () => commit(switchToWeek(live.current.state, Date.now())) },
      ],
    )
  }
  const onDiscard = () => {
    if (lock.current) return
    commit(switchToWeek(live.current.state, Date.now()))
  }
  const onDay = day => {
    if (lock.current) return
    const routines = live.current.view?.routines ?? []
    Alert.alert(day.label, day.names ? day.names.join(' + ') : undefined, [
      ...routines.map(r => ({
        text: r.name,
        onPress: () => commit(setWeekday(live.current.state, day.day, [r.id])),
      })),
      { text: 'Rest day', onPress: () => commit(setWeekday(live.current.state, day.day, null)) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }
  const onAdd = () => {
    if (lock.current) return
    const choices = (live.current.view?.routines ?? []).filter(r => !loopIds(live.current.state).includes(r.id))
    Alert.alert('Add to the rotation', undefined, [
      ...choices.map(r => ({
        text: r.name,
        onPress: () => {
          const state = live.current.state
          const ids = loopIds(state).filter(id => id !== r.id)
          commit(loopEdited(state, [...ids, r.id], loopLabel(state), Date.now()))
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ])
  }
  const onRemove = id => {
    if (lock.current) return
    const state = live.current.state
    commit(loopEdited(state, loopIds(state).filter(x => x !== id), loopLabel(state), Date.now()))
  }
  const onStartOver = () => {
    if (lock.current) return
    if (live.current.sessionOpen) {
      say('Finish the open workout before starting the loop over.')
      return
    }
    commit(startOver(live.current.state, { sessionOpen: false, now: Date.now() }))
  }
  const onStart = () => {
    if (lock.current) return
    commit(switchToRotation(live.current.state, Date.now()))
  }
  const onDate = date => {
    if (lock.current) return
    const routines = live.current.view?.routines ?? []
    const pin = value => {
      const state = live.current.state
      const today = schedulePlan(state, Date.now())?.dates[0]?.iso
      return setDate(state, date.iso, value, { today })
    }
    Alert.alert(date.label, undefined, [
      ...routines.map(r => ({ text: r.name, onPress: () => commit(pin(r.id)) })),
      { text: 'Rest', onPress: () => commit(pin('rest')) },
      { text: 'Back to weekly plan', onPress: () => commit(pin(null)) },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  // The prompt's answer. The copy can go while it is open (Disconnect): then nothing is added.
  const create = async name => {
    if (!live.current.view?.canAuthor) {
      say(PAIR_TO_AUTHOR)
      return
    }
    const routine = newRoutine(name)
    if (!routine) {
      say(NAME_BLANK)
      return
    }
    const result = await plan.create(routine)
    if (result.ok) guard(() => router.push('/routine/' + encodeURIComponent(routine.id)))
    else say(SAVE_FAILED)
  }
  const onNew = () => {
    setMessage(null)
    Alert.prompt('New routine', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Create', onPress: create },
    ], 'plain-text')
  }

  // A line's kind is set only on the order's (plan-view.js noticeLines); a routine's is dismissed as one.
  const dismiss = rid => {
    const line = view?.notices.find(l => l.rid === rid)
    if (line) plan.dismiss(line.rid, line.kind)
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingTop: screenTopInset(Platform.OS) }]}
    >
      <ScreenHeader title="Plan" />
      {!view ? (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          {plan.status === 'error' ? plan.error?.message || 'Could not load your plan.' : 'Loading…'}
        </AppText>
      ) : (
        <>
          <Notices lines={view.notices} onDismiss={dismiss} />
          {editor ? (
            <>
              <ScheduleEditor
                state={plan.state}
                view={view}
                days={editor.days}
                onFixedWeek={onFixedWeek}
                onRotation={onRotation}
                onDay={onDay}
                onAdd={onAdd}
                onRemove={onRemove}
                onStartOver={onStartOver}
                onStart={onStart}
                onDiscard={onDiscard}
              />
              <DatesCard dates={editor.dates} onDate={onDate} />
            </>
          ) : (
            <Schedule schedule={view.schedule} />
          )}
          {message ? (
            <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.pad, styles.message]}>{message}</AppText>
          ) : null}
          <Card style={[styles.card, styles.routines]}>
            <View style={styles.routinesHead}>
              <AppText variant="heading" accessibilityRole="header" style={styles.grow}>Your routines</AppText>
              {view.canAuthor ? (
                <TextButton label="New routine" accessibilityHint="Asks for a name, then opens the new routine." onPress={onNew} />
              ) : null}
            </View>
            {view.canAuthor ? null : (
              <AppText variant="body" color={color.textSecondary} style={styles.gate}>{PAIR_TO_AUTHOR}</AppText>
            )}
            {view.routines.length ? view.routines.map((r, i) => (
              <View key={rows[i].key} style={[styles.row, view.canAuthor && styles.rowMoves]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}, ${exercises(r.count)}`}
                  accessibilityHint="Opens this routine."
                  onPress={() => guard(() => router.push('/routine/' + encodeURIComponent(r.id)))}
                  style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
                >
                  <View style={styles.grow}>
                    <AppText variant="heading">{r.name}</AppText>
                    <AppText variant="label" color={color.textMuted}>{exercises(r.count)}</AppText>
                  </View>
                  <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
                </Pressable>
                {view.canAuthor ? (
                  <>
                    <MoveButton label={`Move ${r.name} up`} hint="Moves this routine up one place and saves." glyph="↑" disabled={!rows[i].up} onPress={() => onMove(r.id, r.name, -1)} />
                    <MoveButton label={`Move ${r.name} down`} hint="Moves this routine down one place and saves." glyph="↓" disabled={!rows[i].down} onPress={() => onMove(r.id, r.name, 1)} />
                  </>
                ) : null}
              </View>
            )) : (
              <AppText variant="body" color={color.textSecondary} style={styles.empty}>No routines in your plan yet.</AppText>
            )}
          </Card>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl },
  pad: { marginHorizontal: space.lg },
  message: { marginBottom: space.lg },
  card: { marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, gap: space.sm },
  modes: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  dayHit: { minHeight: touch.min, justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  order: { minWidth: 20 },
  grow: { flexShrink: 1, flexGrow: 1 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accent },
  // The rows' own touch height spaces them, as Your lifts does.
  routines: { gap: 0, paddingHorizontal: 0, paddingBottom: space.xs },
  routinesHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  gate: { paddingHorizontal: space.lg, paddingBottom: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.stroke
  },
  rowMoves: { paddingRight: space.xs },
  rowBody: {
    flex: 1,
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm
  },
  pressed: { backgroundColor: color.surfaceActive },
  moveHit: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  moveFace: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  empty: { paddingHorizontal: space.lg, paddingVertical: space.md }
})
