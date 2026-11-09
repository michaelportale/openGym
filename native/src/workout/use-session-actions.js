import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import { workoutModel } from '../shared/training.js'
import { createEventId } from '../session/ids'
import { createActionGate } from './action-gate'
import { pendingRest, restMsFor } from './rest-after'
import { shownAfterComplete, withTargets } from './session-screen'
import { carriedWeight, shownValues } from './workout-view'
import { NO_NOTICES, addSetCall, addWarmupCall, completeCall, completeResult, dockKeypadField, draftCall, editCall, findSet, keypadField, noticesAfter, overnightNotice, primaryAction, restAfterComplete, resultNotice, sheetBackgroundCall, sheetCloseCall, sheetMode, sheetOutcome, undoCall } from './set-calls'

const sideLabel = { L: 'Complete left', R: 'Complete right' }
const failed = error => ({ ok: false, saved: false, error: { code: 'storage', message: error?.message || String(error) } })

// Every write the session screen makes, through one action gate: a tap while a write is in
// flight is dropped, so a double tap on Complete logs one set. `view` is this render's view (with
// targets), `screen` is workoutScreen(view, ...). Writes are built from the engine's latest view
// inside the gate, not this render's: a tap landing after the gate frees but before the re-render
// then finds its set already done and writes nothing. A refused write says what was not done and
// why in plain words (failureText), and the screen keeps showing the set as it is stored.
export function useSessionActions({ session, base, restSec, view, screen, shownEntry, setShownIndex }) {
  const gate = useRef(null)
  if (gate.current == null) gate.current = createActionGate()
  const [busy, setBusy] = useState(false)
  // The screen's notice and its "Rest didn't start" line (noticesAfter).
  const [notices, setNotices] = useState(NO_NOTICES)
  const [sheet, setSheet] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetNotice, setSheetNotice] = useState(null)
  const [finishing, setFinishing] = useState(null)
  const [finishNotice, setFinishNotice] = useState(null)
  // Which sheet is on screen (its key), read when a write settles: state in a closure is stale.
  const sheetKeys = useRef(0)
  const openKey = useRef(null)

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
  const report = (result, action) => setNotices(current => noticesAfter(current, result, action))

  // setId and side come from the tap. The commit is awaited first; its rest is named and timed
  // by the row's `at` in the view the commit produced (one side of a per-side set, or a warm-up,
  // earns none). The set is saved either way: a refused (or thrown) rest is `restFailed` on the
  // set's result, shown as "Saved. Rest didn't start." with Start rest; a reopen rebuilds it too.
  const complete = ({ setId, side, values }) => act(async () => {
    const call = completeCall(latest(), { setId, side, values, eventId: createEventId() })
    if (!call) return null
    const result = await session.commitSet(call)
    if (!result?.saved) return result
    const next = latest()
    setShownIndex(index => shownAfterComplete(next, index, setId))
    const rest = restAfterComplete(next, setId, restMsOf)
    if (!rest) return result
    return completeResult(result, await session.startRest(rest).catch(failed))
  })

  // The rest the latest completed work set earned and has not had: on open, the one a kill
  // between Complete and rest left unstarted; on Start rest, the one a refused rest left. It is
  // named restEventId(setId, at), the id its Complete used, so a rest that did land, or one the
  // owner skipped, is not started again. Its time runs from the set's own `at`.
  const restoreRest = () => act(async () => {
    const opened = latest()
    const pending = pendingRest(opened, Date.now(), id => restMsOf(opened.entries.find(entry => entry.id === id)))
    return pending ? session.startRest(pending) : null
  }).then(result => report(result, 'rest'))

  const draft = (setId, values) => act(async () => {
    const call = draftCall(latest(), { setId, values })
    return call ? session.putDraft(call.setId, call.values) : null
  })
  const edit = (setId, values) => act(async () => {
    const call = editCall(latest(), { setId, values, eventId: createEventId() })
    return call ? session.editSet(call) : null
  })

  // Left open overnight: a row, a boxed number or the lead figure says what to pick first and
  // opens nothing, so no set is logged into last night's workout.
  const blockedOvernight = () => {
    const text = overnightNotice(latest())
    if (text) setNotices(current => ({ ...current, notice: text }))
    return text != null
  }

  const openSheet = (setId, field) => {
    if (blockedOvernight()) return
    const found = findSet(view, setId)
    const row = screen.card.rows.find(r => r.setId === setId)
    if (!found || !row) return
    const mode = sheetMode(row.status)
    const perSide = workoutModel.isSideSet(found.slot.row)
    const side = mode === 'current' && perSide ? screen.dock.side : null
    const key = ++sheetKeys.current
    openKey.current = key
    setSheet({
      key,
      setId,
      mode,
      side,
      perSide,
      initial: shownValues(found.slot, side, carriedWeight(found.entry, setId)),
      initialField: keypadField(field, perSide, side),
      title: `${screen.card.name} · ${row.warmup ? 'Warm-up' : `Set ${row.number}`}`,
      completeLabel: sideLabel[side] ?? (row.warmup ? 'Complete warm-up' : `Complete set ${row.number}`),
    })
    setSheetNotice(null)
    setSheetOpen(true)
  }
  // The sheet stays mounted with its last props while it slides away.
  const closeSheet = () => {
    openKey.current = null
    setSheetOpen(false)
  }
  // A refusal stays in the sheet only if that sheet is still open when the write settles;
  // otherwise it shows on the screen, so a failed write is never hidden (sheetOutcome).
  const settle = (result, key, action) => {
    const outcome = sheetOutcome(result, openKey.current === key, action)
    if (!outcome) return
    if (outcome.close) closeSheet()
    if (outcome.sheet) setSheetNotice(outcome.sheet)
    if (outcome.screen) report(result, action)
  }

  const sheetActions = {
    // Save keeps a draft; on a done set it is Update, an edit that keeps the set's time.
    onSave: async values => {
      const done = sheet.mode === 'done'
      settle(done ? await edit(sheet.setId, values) : await draft(sheet.setId, values), sheet.key, done ? 'edit' : 'draft')
    },
    onComplete: async values => settle(await complete({ setId: sheet.setId, side: sheet.side, values }), sheet.key, 'complete'),
    onUndo: async () => settle(await act(async () => {
      const call = undoCall(latest(), { setId: sheet.setId, eventId: createEventId() })
      return call ? session.undoSet(call) : null
    }), sheet.key, 'undo'),
    // Swiping the sheet away (or Close) after typing keeps a draft for any set not done yet; on a
    // done set it cancels. The sheet is gone, so a refusal shows on the screen.
    onClose: async (values, changed) => {
      closeSheet()
      if (sheetCloseCall(sheet.mode, changed) === 'draft') report(await draft(sheet.setId, values), 'draft')
    },
    // The app leaving the front with typed numbers keeps them as a draft through the same gate,
    // so a kill from the app switcher loses nothing. The sheet stays open; a refusal shows in it
    // while it is, else on the screen.
    onAppState: async (appState, values, changed) => {
      if (sheetBackgroundCall(appState, sheet.mode, changed) !== 'draft') return
      const { key, setId } = sheet
      const text = resultNotice(await draft(setId, values), 'draft')
      if (!text) return
      if (openKey.current === key) setSheetNotice(text)
      else setNotices(current => ({ ...current, notice: text }))
    },
  }

  // Add set and Add warm-up append a row to the exercise on screen; `callFor` builds it from the
  // engine's latest view.
  const addRow = (callFor, action) => async () => {
    if (blockedOvernight() || !shownEntry) return
    report(await act(async () => {
      const call = callFor(latest(), shownEntry.id, createEventId())
      return call ? session.addSet(call) : null
    }), action)
  }

  const openFinish = end => {
    setFinishNotice(null)
    setFinishing({ end: end ?? null })
  }

  const discardNow = async () => {
    setFinishing(null)
    report(await act(() => session.discard()), 'discard')
  }

  const dockActions = {
    onPrimary: async () => {
      const { mode, setId, side } = screen.dock
      const action = primaryAction(mode)
      if (action === 'complete') report(await complete({ setId, side }), 'complete')
      else if (action === 'keypad') openSheet(setId, dockKeypadField(mode))
      else if (action === 'follow') setShownIndex(null)
      else if (action === 'finish') openFinish(null)
    },
    onPressLead: () => openSheet(screen.dock.setId, dockKeypadField(screen.dock.mode)),
    onAddTime: async () => report(await act(() => session.extendRest({ eventId: createEventId(), byMs: 30_000 })), 'add-time'),
    onSkip: async () => report(await act(() => session.cancelRest({ eventId: createEventId() })), 'skip-rest'),
  }

  return {
    busy,
    notice: notices.notice,
    // "Saved. Rest didn't start." (or why Start rest was refused), with its Start rest button.
    restNotice: notices.rest,
    restoreRest,
    startRest: () => {
      if (!blockedOvernight()) restoreRest()
    },
    openSheet,
    addSet: addRow(addSetCall, 'add-set'),
    addWarmup: addRow(addWarmupCall, 'add-warmup'),
    resume: async () => report(await act(() => session.resume({ eventId: createEventId() })), 'resume'),
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
        const text = resultNotice(result, 'finish')
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
