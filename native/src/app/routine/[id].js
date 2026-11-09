import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, space, touch } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import IconButton from '../../ui/IconButton'
import ScaleButton from '../../ui/ScaleButton'
import { usePushLock } from '../../ui/use-push-lock'
import { routeId } from '../../exercises/route-id'
import { Notices } from '../../plan/PlanScreen'
import SlotSheet from '../../plan/SlotSheet'
import { waitForPick } from '../../plan/pick-relay'
import { MISSING_ROUTINE, UNSAFE_EDIT, findRoutine, noticeLines, routineView, savedRoutine } from '../../plan/plan-view'
import { moveSlot, swapSlot } from '../../plan/slot-edit'
import { usePlan } from '../../plan/use-plan'

const FAILED = "Couldn't save. Try again."

const slotAt = (routine, index) => {
  const slot = Array.isArray(routine?.ex) ? routine.ex[index] : null
  return slot && typeof slot === 'object' ? slot : null
}

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

// One routine: its name, its own progression rule, and one row per exercise with Move up and Move
// down. The row opens the exercise sheet (Swap and the fields). Every write lands on the routine as
// this screen shows it, with the copy's or the snapshot's routine as the base the guard checks.
export default function RoutineScreen() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const guard = usePushLock()
  const id = routeId(params.id)
  const plan = usePlan()
  const ready = plan.status === 'ready'
  const stored = ready ? findRoutine(plan.state, id) : null
  const base = plan.baseOf(id)

  // This screen's writes go one after another, and the routine the last one leaves is shown at
  // once, ahead of the store, until every write has been read back. Five taps on Move up move an
  // exercise five places, each from the order on screen, however long a save takes.
  const [ahead, setAheadState] = useState(null)
  const aheadRef = useRef(null)
  const writes = useRef({ queue: Promise.resolve(), pending: 0 })
  const setAhead = next => {
    aheadRef.current = next
    setAheadState(next)
  }
  const routine = stored ? ahead ?? stored : null
  // Read when a tap lands or the picker answers, not when the handler was made.
  const latest = useRef(null)
  latest.current = { stored, base, state: plan.state }
  const current = () => aheadRef.current ?? latest.current.stored

  const commit = next => {
    setAhead(next)
    writes.current.pending += 1
    const run = writes.current.queue.then(() => plan.save({ rid: id, routine: next, copyRoutine: latest.current.base }))
    writes.current.queue = run
    return run.then(result => {
      writes.current.pending -= 1
      if (writes.current.pending === 0) setAhead(null)
      return result
    })
  }

  const view = useMemo(
    () => (ready ? routineView(plan.state, id, { unit: 'lb', names: plan.names, routine: ahead }) : null),
    [ready, plan.state, plan.names, id, ahead]
  )
  const notices = useMemo(() => noticeLines(plan.notices).filter(n => n.rid === id), [plan.notices, id])

  // A refusal or a failed write, shown until the next action.
  const [message, setMessage] = useState(null)

  // Saved at once; an unsafe result is never saved.
  const onRowMove = (index, dir) => {
    setMessage(null)
    const from = current()
    const result = from ? moveSlot(from, index, dir, latest.current.base) : null
    if (!result) return
    if (result.unsafe) {
      setMessage(UNSAFE_EDIT)
      return
    }
    commit(result.routine).then(r => { if (!r.ok) setMessage(FAILED) })
  }

  // The sheet: which slot it was opened on (index and exercise id, so a sync that moves that
  // exercise away closes it), that slot and routine as they were (shown while it closes), and
  // what it says. It stays mounted while closed, so it slides away; each open remounts it (key).
  const [sheet, setSheet] = useState(null)
  const opens = useRef(0)
  const live = sheet?.open && slotAt(routine, sheet.index)?.id === sheet.slotId ? slotAt(routine, sheet.index) : null
  // Run once the sheet has gone: a push while the sheet is still being dismissed can be dropped.
  const afterClose = useRef(null)
  const runAfterClose = () => {
    const fn = afterClose.current
    afterClose.current = null
    fn?.()
  }

  const patch = p => setSheet(s => (s ? { ...s, ...p } : s))
  const close = () => patch({ open: false })
  const open = row => {
    const slot = slotAt(routine, row.index)
    if (!slot) return
    setMessage(null)
    setSheet({ no: ++opens.current, open: true, index: row.index, slotId: row.id, title: row.name, slot, routine, message: null, busy: false })
  }

  const onSave = async form => {
    if (!live) return
    const next = savedRoutine(routine, sheet.index, form)
    if (!next) {
      close()
      return
    }
    patch({ busy: true, message: null })
    const result = await commit(next)
    patch(result.ok ? { busy: false, open: false } : { busy: false, message: FAILED })
  }

  const onSwap = () => {
    if (!live) return
    const { index, slotId, title } = sheet
    const token = waitForPick(exId => {
      const now = current()
      if (slotAt(now, index)?.id !== slotId) return 'gone'
      const result = swapSlot(now, index, exId, latest.current.state, latest.current.base)
      if (!result) return 'same'
      if (result.unsafe) return 'unsafe'
      commit(result.routine).then(r => { if (!r.ok) setMessage(FAILED) })
      return 'saved'
    })
    afterClose.current = () => guard(() => router.push({ pathname: '/routine-pick', params: { token, name: title } }))
    close()
    // In case the sheet's dismissal is never reported.
    setTimeout(runAfterClose, 700)
  }

  const body = () => {
    if (plan.status === 'loading') return null
    if (plan.status === 'error') {
      return <AppText variant="body" color={color.textSecondary} style={styles.pad}>{plan.error?.message || 'Could not load this routine.'}</AppText>
    }
    return (
      <>
        <Notices lines={notices} onDismiss={plan.dismiss} />
        {!view ? (
          <AppText variant="body" color={color.textSecondary} style={styles.pad}>{MISSING_ROUTINE}</AppText>
        ) : (
          <>
            <AppText variant="title" accessibilityRole="header" style={styles.pad}>{view.name}</AppText>
            <AppText variant="body" color={color.textSecondary} style={styles.pad}>{view.progLabel}</AppText>
            {message ? (
              <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.pad}>{message}</AppText>
            ) : null}
            <Card style={styles.list}>
              {view.rows.length ? view.rows.map((row, i) => (
                <View key={row.index} style={[styles.row, i > 0 && styles.divided]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${row.name}, ${row.line}${row.superset ? ', superset' : ''}`}
                    accessibilityHint="Opens this exercise's settings."
                    onPress={() => open(row)}
                    style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
                  >
                    <View style={styles.grow}>
                      <AppText variant="heading">{row.name}</AppText>
                      <AppText variant="body" color={color.textSecondary}>{row.line}</AppText>
                    </View>
                    {row.superset ? <AppText variant="label" color={color.accent} style={styles.tag}>Superset</AppText> : null}
                  </Pressable>
                  <MoveButton label={`Move ${row.name} up`} hint="Moves this exercise up one place and saves." glyph="↑" disabled={!row.up} onPress={() => onRowMove(row.index, -1)} />
                  <MoveButton label={`Move ${row.name} down`} hint="Moves this exercise down one place and saves." glyph="↓" disabled={!row.down} onPress={() => onRowMove(row.index, 1)} />
                </View>
              )) : (
                <AppText variant="body" color={color.textSecondary} style={styles.empty}>No exercises in this routine.</AppText>
              )}
            </Card>
          </>
        )}
      </>
    )
  }

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.back}>
          <IconButton label="Back" accessibilityLabel="Back" onPress={() => router.back()} />
        </View>
        {body()}
      </ScrollView>
      {sheet ? (
        <SlotSheet
          key={sheet.no}
          visible={!!live}
          title={sheet.title}
          slot={live ?? sheet.slot}
          routine={live ? routine : sheet.routine}
          message={sheet.message}
          busy={sheet.busy}
          onSave={onSave}
          onSwap={onSwap}
          onClose={close}
          onDismiss={runAfterClose}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl * 2, gap: space.md },
  back: { paddingHorizontal: space.lg, alignItems: 'flex-start' },
  pad: { marginHorizontal: space.lg },
  list: { marginHorizontal: space.lg, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: space.xs },
  divided: { borderTopColor: color.stroke, borderTopWidth: StyleSheet.hairlineWidth },
  rowBody: { flex: 1, minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  pressed: { backgroundColor: color.surfaceActive },
  grow: { flexShrink: 1, flexGrow: 1, gap: 2 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accent },
  moveHit: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  moveFace: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  empty: { padding: space.md }
})
