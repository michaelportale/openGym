import { useEffect, useMemo, useRef, useState } from 'react'
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
import { announce } from '../../plan/announce'
import { waitForPick } from '../../plan/pick-relay'
import { createWriteChain } from '../../plan/write-chain'
import { MISSING_ROUTINE, UNSAFE_EDIT, findRoutine, indexOfKey, movedText, noticeLines, routineView, savedRoutine } from '../../plan/plan-view'
import { moveSlot, stepInvalid, swapSlot } from '../../plan/slot-edit'
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
  const { base, fresh } = plan.baseOf(id)

  // This screen's writes go one after another (plan/write-chain.js), each a routine with the base
  // it was made on (and whether that base is the snapshot's, so its row starts fresh), and the last
  // one's routine is shown at once, ahead of the store, until every write has run and a render
  // shows the store holding it. Five taps on Move up move an exercise five places, each from the
  // order on screen, however long a save takes; a sync landing mid-chain never lends its newer
  // base to a routine made before it.
  const [ahead, setAhead] = useState(null)
  const saveRef = useRef(null)
  saveRef.current = next => plan.save({ rid: id, routine: next.routine, copyRoutine: next.base, fresh: next.fresh })
  const [chain] = useState(() => createWriteChain(next => saveRef.current(next), setAhead))
  // Each stored routine this screen renders: the chain's last write stays ahead until one holds it.
  useEffect(() => { chain.seen({ routine: stored }) }, [chain, stored])
  const routine = stored ? ahead?.routine ?? stored : null
  // Read when a tap lands or the picker answers, not when the handler was made.
  const latest = useRef(null)
  latest.current = { stored: { routine: stored, base, fresh }, state: plan.state }
  // The routine the next edit builds on, with its base: the chain's while one runs, else the store's.
  const current = () => chain.from(latest.current.stored)

  const view = useMemo(
    () => (ready ? routineView(plan.state, id, { unit: 'lb', names: plan.names, routine: ahead?.routine ?? null }) : null),
    [ready, plan.state, plan.names, id, ahead]
  )
  const notices = useMemo(() => noticeLines(plan.notices).filter(n => n.rid === id), [plan.notices, id])

  // A refusal or a failed write, shown until the next action, and said to VoiceOver (announce).
  // A failed write's message goes once a later write in the chain lands.
  const [message, setMessage] = useState(null)
  const say = text => {
    setMessage(text)
    announce(text)
  }
  const landed = r => {
    if (r.ok) setMessage(m => (m === FAILED ? null : m))
    else say(FAILED)
  }

  // Saved at once; an unsafe result is never saved. The row's buttons carry its slot's key, and the
  // slot is found where it is when the tap lands (a VoiceOver user's second tap on the same button
  // moves the same exercise, not whichever moved into its place); gone, the tap does nothing.
  const onRowMove = (key, name, dir) => {
    setMessage(null)
    const from = current()
    const index = indexOfKey(from.routine, key)
    const result = index >= 0 ? moveSlot(from.routine, index, dir, from.base) : null
    if (!result) return
    if (result.unsafe) {
      say(UNSAFE_EDIT)
      return
    }
    chain.commit({ routine: result.routine, base: from.base, fresh: from.fresh }).then(landed)
    announce(movedText(name, index, result.at, result.routine.ex.length))
  }

  // The sheet: which slot it was opened on (index and exercise id, so a sync that moves that
  // exercise away closes it), that slot, the routine and base it was opened on (Save builds on
  // that pair), and what it says. It stays mounted while closed, so it slides away; each open
  // remounts it (key).
  const [sheet, setSheet] = useState(null)
  const opens = useRef(0)
  const live = sheet?.open && slotAt(routine, sheet.index)?.id === sheet.slotId ? slotAt(routine, sheet.index) : null
  // Run once the sheet has gone: a push while the sheet is still being dismissed can be dropped.
  // `fallback` is the timer in case the dismissal is never reported, cleared when it is and when
  // the screen goes.
  const afterClose = useRef(null)
  const fallback = useRef(null)
  const runAfterClose = () => {
    clearTimeout(fallback.current)
    fallback.current = null
    const fn = afterClose.current
    afterClose.current = null
    fn?.()
  }
  useEffect(() => () => clearTimeout(fallback.current), [])

  const patch = p => setSheet(s => (s ? { ...s, ...p } : s))
  const close = () => patch({ open: false })
  const open = row => {
    const from = current()
    const index = indexOfKey(from.routine, row.key)
    const slot = slotAt(from.routine, index)
    if (!slot) return
    setMessage(null)
    setSheet({ no: ++opens.current, open: true, index, slotId: row.id, title: row.name, slot, routine: from.routine, base: from.base, fresh: from.fresh, message: null, busy: false })
  }

  const onSave = async form => {
    // The sheet refuses Save while the Step is invalid; nothing is written then either way.
    if (!live || stepInvalid(form, slotAt(sheet.routine, sheet.index), sheet.routine)) return
    const next = savedRoutine(sheet.routine, sheet.index, form)
    if (!next) {
      close()
      return
    }
    patch({ busy: true, message: null })
    const result = await chain.commit({ routine: next, base: sheet.base, fresh: sheet.fresh })
    if (result.ok) {
      patch({ busy: false, open: false })
      setMessage(m => (m === FAILED ? null : m))
    } else {
      patch({ busy: false, message: FAILED })
      announce(FAILED)
    }
  }

  const onSwap = () => {
    if (!live) return
    const { index, slotId, title } = sheet
    const token = waitForPick(exId => {
      const now = current()
      if (slotAt(now.routine, index)?.id !== slotId) return 'gone'
      const result = swapSlot(now.routine, index, exId, latest.current.state, now.base)
      if (!result) return 'same'
      if (result.unsafe) return 'unsafe'
      chain.commit({ routine: result.routine, base: now.base, fresh: now.fresh }).then(landed)
      return 'saved'
    })
    afterClose.current = () => guard(() => router.push({ pathname: '/routine-pick', params: { token, name: title } }))
    close()
    clearTimeout(fallback.current)
    fallback.current = setTimeout(runAfterClose, 700)
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
                <View key={row.key} style={[styles.row, i > 0 && styles.divided]}>
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
                  <MoveButton label={`Move ${row.name} up`} hint="Moves this exercise up one place and saves." glyph="↑" disabled={!row.up} onPress={() => onRowMove(row.key, row.name, -1)} />
                  <MoveButton label={`Move ${row.name} down`} hint="Moves this exercise down one place and saves." glyph="↓" disabled={!row.down} onPress={() => onRowMove(row.key, row.name, 1)} />
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
