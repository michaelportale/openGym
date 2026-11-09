import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import { workoutModel } from '../shared/training.js'
import { createEventId } from '../session/ids'
import { createActionGate } from './action-gate'
import { pendingRest, restMsFor } from './rest-after'
import { shownAfterComplete, withTargets } from './session-screen'
import { addSetCall, completeCall, editCall, findSet, keypadField, primaryAction, restAfterComplete, resultNotice, sheetCloseCall, sheetMode, shownValues, undoCall } from './set-calls'

const sideLabel = { L: 'Complete left', R: 'Complete right' }
const failed = error => ({ ok: false, saved: false, error: { code: 'storage', message: error?.message || String(error) } })

// Every write the session screen makes, through one action gate: a tap while a write is in
// flight is dropped, so a double tap on Complete logs one set. `view` is this render's view (with
// targets), `screen` is workoutScreen(view, ...). Writes are built from the engine's latest view
// inside the gate, not this render's: a tap landing after the gate frees but before the re-render
// then finds its set already done and writes nothing. A refused write shows as "Not saved: ..."
// and the screen keeps showing the set as it is stored.
export function useSessionActions({ session, base, restSec, view, screen, shownEntry, setShownIndex }) {
  const gate = useRef(null)
  if (gate.current == null) gate.current = createActionGate()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetNotice, setSheetNotice] = useState(null)
  const [finishing, setFinishing] = useState(null)
  const [finishNotice, setFinishNotice] = useState(null)

  const restMsOf = entry => restMsFor(entry, restSec)
  const latest = () => withTargets(session.getState().view, base)

  // A throw from storage is a refused write too, never an uncaught promise.
  const act = fn => gate.current(async () => {
    setBusy(true)
    try {
      return await fn()
    } catch (error) {
      return failed(error)
    } finally {
      setBusy(false)
    }
  })
  const report = result => {
    if (!result?.ignored) setNotice(resultNotice(result))
  }

  // setId and side come from the tap. The commit is awaited first; its rest is named and timed
  // by the row's `at` in the view the commit produced (one side of a per-side set earns none).
  const complete = ({ setId, side, values }) => act(async () => {
    const call = completeCall(latest(), { setId, side, values, eventId: createEventId() })
    if (!call) return null
    const result = await session.commitSet(call)
    if (!result?.saved) return result
    const next = latest()
    setShownIndex(index => shownAfterComplete(next, index))
    const rest = restAfterComplete(next, setId, restMsOf)
    if (!rest) return result
    const started = await session.startRest(rest)
    // The set is saved either way. A refused rest is what to report; a reopen rebuilds it.
    return resultNotice(started) ? { ...started, committed: true } : result
  })

  // On open: the rest a kill between Complete and rest left unstarted. A skipped one is not
  // started again: its id is already in the journal.
  const restoreRest = () => act(async () => {
    const opened = latest()
    const pending = pendingRest(opened, Date.now(), id => restMsOf(opened.entries.find(entry => entry.id === id)))
    return pending ? session.startRest(pending) : null
  }).then(report)

  const draft = (setId, values) => act(() => session.putDraft(setId, values))
  const edit = (setId, values) => act(async () => {
    const call = editCall(latest(), { setId, values, eventId: createEventId() })
    return call ? session.editSet(call) : null
  })

  const openSheet = (setId, field) => {
    const found = findSet(view, setId)
    const row = screen.card.rows.find(r => r.setId === setId)
    if (!found || !row) return
    const mode = sheetMode(row.status)
    const perSide = workoutModel.isSideSet(found.slot.row)
    const side = mode === 'current' && perSide ? screen.dock.side : null
    setSheet(current => ({
      key: (current?.key ?? 0) + 1,
      setId,
      mode,
      side,
      perSide,
      initial: shownValues(found.slot, side),
      initialField: keypadField(field, perSide, side),
      title: `${screen.card.name} · Set ${row.number}`,
      completeLabel: sideLabel[side] ?? `Complete set ${row.number}`,
    }))
    setSheetNotice(null)
    setSheetOpen(true)
  }
  // The sheet stays mounted with its last props while it slides away.
  const closeSheet = () => setSheetOpen(false)
  const afterSheetWrite = result => {
    if (result?.ignored) return
    const text = resultNotice(result)
    if (text) {
      setSheetNotice(text)
      return
    }
    closeSheet()
    setNotice(null)
  }

  const sheetActions = {
    // Save keeps a draft; on a done set it is Update, an edit that keeps the set's time.
    onSave: async values => afterSheetWrite(sheet.mode === 'done' ? await edit(sheet.setId, values) : await draft(sheet.setId, values)),
    onComplete: async values => {
      const result = await complete({ setId: sheet.setId, side: sheet.side, values })
      if (result?.ignored) return
      if (result?.committed) {
        closeSheet()
        setNotice(resultNotice(result))
        return
      }
      afterSheetWrite(result)
    },
    onUndo: async () => afterSheetWrite(await act(async () => {
      const call = undoCall(latest(), { setId: sheet.setId, eventId: createEventId() })
      return call ? session.undoSet(call) : null
    })),
    // Swiping the sheet away after typing keeps it, as Save does. It is already gone, so a
    // refused write shows on the screen.
    onClose: async (values, changed) => {
      closeSheet()
      const kind = sheetCloseCall(sheet.mode, changed)
      if (kind === 'none') return
      report(kind === 'edit' ? await edit(sheet.setId, values) : await draft(sheet.setId, values))
    },
  }

  const openFinish = end => {
    setFinishNotice(null)
    setFinishing({ end: end ?? null })
  }

  const discardNow = async () => {
    setFinishing(null)
    report(await act(() => session.discard()))
  }

  const dockActions = {
    onPrimary: async () => {
      const { mode, setId, side } = screen.dock
      const action = primaryAction(mode)
      if (action === 'complete') report(await complete({ setId, side }))
      else if (action === 'keypad') openSheet(setId, 'w')
      else if (action === 'follow') setShownIndex(null)
      else if (action === 'finish') openFinish(null)
    },
    onPressLead: () => openSheet(screen.dock.setId, 'w'),
    onAddTime: async () => report(await act(() => session.extendRest({ eventId: createEventId(), byMs: 30_000 }))),
    onSkip: async () => report(await act(() => session.cancelRest({ eventId: createEventId() }))),
  }

  return {
    busy,
    notice,
    restoreRest,
    openSheet,
    addSet: async () => {
      if (shownEntry) report(await act(() => session.addSet(addSetCall(shownEntry, createEventId()))))
    },
    resume: async () => report(await act(() => session.resume({ eventId: createEventId() }))),
    dock: dockActions,
    sheet: { ...sheet, open: sheetOpen, notice: sheetNotice, ...sheetActions },
    finish: {
      open: finishing != null,
      endsAtLastSet: finishing?.end != null,
      notice: finishNotice,
      show: openFinish,
      close: () => setFinishing(null),
      confirm: async () => {
        const end = finishing?.end
        const result = await act(() => session.finishSession({ sender: async () => ({ saved: true }), ...(end != null ? { end } : {}) }))
        if (result?.ignored) return
        const text = resultNotice(result)
        if (text) setFinishNotice(text)
        else setFinishing(null)
      },
    },
    // A destructive confirm that names the routine.
    askDiscard: () => {
      Alert.alert(`Discard ${base?.name ?? 'this workout'}?`, 'Every set logged in this workout is deleted from this phone.', [
        { text: 'Keep workout', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: discardNow },
      ])
    },
  }
}
