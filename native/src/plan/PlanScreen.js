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
import { nextRoutineId } from '../workout/next-up'
import { announce } from './announce'
import { NAME_BLANK, PAIR_TO_AUTHOR, movedText, orderMoved, planView } from './plan-view'
import { newRoutine } from './routine-edit'
import { usePlan } from './use-plan'

const exercises = n => (n === 1 ? '1 exercise' : `${n} exercises`)

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
// opens its own screen. With a server copy held, New routine adds one (named first, then opened)
// and each row has Move up and Move down, which save the whole order; without one, a sentence says
// to pair instead (planView canAuthor).
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
  live.current = { view, copy: plan.copy }

  // A refusal or a failed save, shown until the next action, and said to VoiceOver (announce).
  const [message, setMessage] = useState(null)
  const say = text => {
    setMessage(text)
    announce(text)
  }

  // One move at a time, each built on the order on screen: a tap is ignored while a move saves,
  // and until the screen has rendered what it saved (the lock opens in an effect after the render
  // that follows the save; usePlan's reload is done by then).
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
          <Schedule schedule={view.schedule} />
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
