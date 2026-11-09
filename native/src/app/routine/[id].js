import { useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, space, touch } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import IconButton from '../../ui/IconButton'
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

// One routine: its name, its own progression rule, and one row per exercise. A row opens the
// exercise sheet. Every write lands on the routine as this screen shows it (pending edits
// included), with the copy's or the snapshot's routine as the base the guard checks against.
export default function RoutineScreen() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const guard = usePushLock()
  const id = routeId(params.id)
  const plan = usePlan()
  const ready = plan.status === 'ready'
  const view = useMemo(() => (ready ? routineView(plan.state, id, { unit: 'lb', names: plan.names }) : null), [ready, plan.state, plan.names, id])
  const notices = useMemo(() => noticeLines(plan.notices).filter(n => n.rid === id), [plan.notices, id])
  const routine = ready ? findRoutine(plan.state, id) : null
  const base = plan.baseOf(id)

  // The sheet: which slot it was opened on (index and exercise id, so a sync that moves that
  // exercise away closes it), that slot and routine as they were (shown while it closes), and
  // what it says. It stays mounted while closed, so it slides away; each open remounts it (key).
  const [sheet, setSheet] = useState(null)
  const [swapError, setSwapError] = useState(null)
  const opens = useRef(0)
  const live = sheet?.open && slotAt(routine, sheet.index)?.id === sheet.slotId ? slotAt(routine, sheet.index) : null
  const moves = useMemo(
    () => (live ? { up: moveSlot(routine, sheet.index, -1, base), down: moveSlot(routine, sheet.index, 1, base) } : { up: null, down: null }),
    [live, routine, sheet?.index, base]
  )
  // The picker answers after this screen has rendered again; it reads the routine as it is then.
  const latest = useRef(null)
  latest.current = { routine, base, state: plan.state }
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
    setSwapError(null)
    setSheet({ no: ++opens.current, open: true, index: row.index, slotId: row.id, title: row.name, slot, routine, message: null, busy: false })
  }

  const write = async next => {
    patch({ busy: true, message: null })
    const result = await plan.save({ rid: id, routine: next, copyRoutine: base })
    patch(result.ok ? { busy: false, open: false } : { busy: false, message: FAILED })
  }

  const onSave = form => {
    if (!live) return
    const next = savedRoutine(routine, sheet.index, form)
    if (next) write(next)
    else close()
  }

  // Saved at once. An unsafe result is never saved: the sheet says so.
  const onMove = dir => {
    const result = live ? (dir < 0 ? moves.up : moves.down) : null
    if (!result) return
    if (result.unsafe) patch({ message: UNSAFE_EDIT })
    else write(result.routine)
  }

  const onSwap = () => {
    if (!live) return
    const { index, slotId, title } = sheet
    const token = waitForPick(exId => {
      const now = latest.current
      if (slotAt(now.routine, index)?.id !== slotId) return 'gone'
      const result = swapSlot(now.routine, index, exId, now.state, now.base)
      if (!result) return 'same'
      if (result.unsafe) return 'unsafe'
      plan.save({ rid: id, routine: result.routine, copyRoutine: now.base }).then(r => { if (!r.ok) setSwapError(FAILED) })
      return 'saved'
    })
    afterClose.current = () => guard(() => router.push({ pathname: '/routine/pick', params: { token, name: title } }))
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
            {swapError ? (
              <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.pad}>{swapError}</AppText>
            ) : null}
            <Card style={styles.list}>
              {view.rows.length ? view.rows.map((row, i) => (
                <Pressable
                  key={row.index}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name}, ${row.line}${row.superset ? ', superset' : ''}`}
                  accessibilityHint="Opens this exercise's settings."
                  onPress={() => open(row)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <View style={styles.grow}>
                    <AppText variant="heading">{row.name}</AppText>
                    <AppText variant="body" color={color.textSecondary}>{row.line}</AppText>
                  </View>
                  {row.superset ? <AppText variant="label" color={color.accent} style={styles.tag}>Superset</AppText> : null}
                </Pressable>
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
          moves={moves}
          message={sheet.message}
          busy={sheet.busy}
          onSave={onSave}
          onMove={onMove}
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
  row: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  divided: { borderTopColor: color.stroke, borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { backgroundColor: color.surfaceActive },
  grow: { flexShrink: 1, flexGrow: 1, gap: 2 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accent },
  empty: { padding: space.md }
})
