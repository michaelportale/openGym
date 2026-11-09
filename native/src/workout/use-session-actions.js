import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Alert } from 'react-native'
import { workoutModel } from '../shared/training.js'
import { createEventId } from '../session/ids'
import { createActionGate } from './action-gate'
import { pendingRest, restMsFor } from './rest-after'
import { shownAfterComplete, withTargets } from './session-screen'
import { carriedWeight, lockedWeight, shownValues } from './workout-view'
import { NO_NOTICES, addSetCall, addWarmupCall, completeAfterCommit, completeCall, dockKeypadField, draftCall, editCall, findSet, finishRetarget, keypadField, noticeAnnouncement, noticeStamp, noticesAfter, overnightNotice, overnightRefusal, primaryAction, restAfterComplete, resultNotice, sheetBackgroundCall, sheetCloseCall, sheetMode, sheetOutcome, thrown, undoWrite } from './set-calls'

const sideLabel = { L: 'Complete left', R: 'Complete right' }

// Every write the session screen makes, through one action gate: a tap while a write is in
// flight is dropped, so a double tap on Complete logs one set. `view` is this render's view (with
// targets), `screen` is workoutScreen(view, ...). Writes are built from the engine's latest view
// inside the gate, not this render's: a tap landing after the gate frees but before the re-render
// then finds its set already done and writes nothing. A refused write says what was not done and
// why in plain words (failureText), and the screen keeps showing the set as it is stored.
// Overnight is checked inside the gate as each write runs, against the clock then, not when the
// view was last drawn (write).
export function useSessionActions({ session, base, restSec, view, screen, shownEntry, setShownIndex }) {
  const gate = useRef(null)
  if (gate.current == null) gate.current = createActionGate()
  const [busy, setBusy] = useState(false)
  // The screen's notice and its "Rest didn't start" line (noticesAfter). Every notice here is a
  // noticeStamp ({ text, seq }); the screen and the sheets get its text.
  const [notices, setNotices] = useState(NO_NOTICES)
  const [sheet, setSheet] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetNotice, setSheetNotice] = useState(null)
  const [finishing, setFinishing] = useState(null)
  const [finishNotice, setFinishNotice] = useState(null)
  // Each reported outcome takes the next number, so the same words reported again are a new
  // notice: the state changes and it is spoken again.
  const reports = useRef(0)
  const nextStamp = () => noticeStamp(++reports.current)
  // VoiceOver speaks neither live regions nor the alert role: speak each notice (the screen's,
  // its rest line, the keypad's, Finish's) once per report (noticeAnnouncement). Queued, not
  // interrupting: a sheet write's notice lands as the sheet slides away, and iOS would cut an
  // unqueued announcement off when VoiceOver moves to the screen beneath. (React Native falls
  // back to the plain announcement where the queue option is not available.)
  const spoken = useRef(null)
  const shownNotices = { ...notices, sheet: sheetNotice, finish: finishNotice }
  useEffect(() => {
    const text = noticeAnnouncement(spoken.current, shownNotices)
    spoken.current = shownNotices
    if (text) AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true })
  }, [notices, sheetNotice, finishNotice])
  // Which sheet is on screen (its key), read when a write settles: state in a closure is stale.
  const sheetKeys = useRef(0)
  const openKey = useRef(null)

  const restMsOf = entry => restMsFor(entry, restSec)
  const latest = () => withTargets(session.getState().view, base)

  // A throw from storage is a refused write too, never an uncaught promise. A write refused
  // overnight reloads the view (writing nothing), so the overnight dock shows without another tap.
  const act = fn => gate.current(async () => {
    setBusy(true)
    try {
      const result = await fn()
      if (result?.error?.code === 'overnight') await session.refresh()
      return result
    } catch (error) {
      return thrown(error)
    } finally {
      setBusy(false)
    }
  })
  const report = (result, action) => {
    const stamp = nextStamp()
    setNotices(current => noticesAfter(current, result, action, stamp))
  }

  // Every write but the three overnight choices (Resume, Finish, Discard). Right before it writes,
  // inside the gate, overnight is checked against the clock now in the session's own zone: a
  // workout left on screen across midnight takes nothing into last night's session, and the tap
  // says to choose first.
  // `build(view, now)` makes the write from the engine's latest view through a decision helper
  // given that same clock.
  const write = build => act(async () => {
    const view = latest()
    const now = Date.now()
    return overnightRefusal(view, now) ?? build(view, now)
  })

  // setId and side come from the tap. The commit is awaited first; its rest is named and timed
  // by the row's `at` in the view the commit produced (one side of a per-side set, or a warm-up,
  // earns none). The set is saved either way: a refused rest, or anything that throws after the
  // commit, is `restFailed` on the set's result (completeAfterCommit), shown as "Saved. Rest
  // didn't start." with Start rest; a reopen rebuilds it too. The rest is a write of its own, so
  // it is checked again: a midnight between the commit and it refuses it (and reloads the view)
  // like any other.
  const complete = ({ setId, side, values }) => write(async (view, now) => {
    const call = completeCall(view, { setId, side, values, eventId: createEventId(), now })
    if (!call) return null
    return completeAfterCommit(await session.commitSet(call), async () => {
      const next = latest()
      setShownIndex(index => shownAfterComplete(next, index, setId))
      const rest = restAfterComplete(next, setId, restMsOf)
      if (!rest) return null
      const refused = overnightRefusal(next, Date.now())
      if (!refused) return session.startRest(rest)
      await session.refresh()
      return refused
    })
  })

  // The rest the latest completed work set earned and has not had: on open ('rest'), the one a
  // kill between Complete and rest left unstarted; on the Start rest tap ('start-rest'), the one a
  // refused rest left. It is named restEventId(setId, at), the id its Complete used, so a rest that
  // did land, or one the owner skipped, is not started again. Its time runs from the set's own
  // `at`; null when it has run out. Overnight a rest due is refused like any write; none due says
  // nothing (on open, the overnight dock already asks).
  const startPendingRest = action => act(async () => {
    const opened = latest()
    const now = Date.now()
    const pending = pendingRest(opened, now, id => restMsOf(opened.entries.find(entry => entry.id === id)))
    if (!pending) return null
    return overnightRefusal(opened, now) ?? session.startRest(pending)
  }).then(result => report(result, action))
  const restoreRest = () => startPendingRest('rest')

  const putDraft = (setId, values) => async (view, now) => {
    const call = draftCall(view, { setId, values, now })
    return call ? session.putDraft(call.setId, call.values) : null
  }
  const draft = (setId, values) => write(putDraft(setId, values))
  // The typed numbers kept as the app leaves the front. Through the gate like every write, and the
  // same checks, but it holds the gate for that one draft write and nothing more: no busy flag and
  // no view reload after an overnight refusal (nothing on screen changes while the app leaves; the
  // next tap, or the new-day reopen, reloads it). A tap that lands during the write is dropped by
  // the gate ({ ignored: true }), as during any write; holding nothing else keeps that window to
  // the write itself.
  const keepDraft = (setId, values) => gate.current(async () => {
    const view = latest()
    const now = Date.now()
    return overnightRefusal(view, now) ?? putDraft(setId, values)(view, now)
  }).catch(thrown)
  const edit = (setId, values) => write(async (view, now) => {
    const call = editCall(view, { setId, values, eventId: createEventId(), now })
    return call ? session.editSet(call) : null
  })

  // Left open overnight: a row, a boxed number or the lead figure says what to pick first and
  // opens nothing, so no set is logged into last night's workout. Read at the clock now; a view
  // drawn before midnight is reloaded so the overnight dock shows.
  const blockedOvernight = () => {
    const text = overnightNotice(latest(), Date.now())
    if (text == null) return false
    const notice = nextStamp()(text)
    setNotices(current => ({ ...current, notice }))
    // A reload that fails leaves the notice; the next tap refuses and reloads again.
    session.refresh().catch(() => {})
    return true
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
      // A half-done per-side set's weight stays the one its first side was logged at.
      weightSetWith: lockedWeight(found.slot.row)?.side ?? null,
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
    if (outcome.sheet) setSheetNotice(nextStamp()(outcome.sheet))
    if (outcome.screen) report(result, action)
  }

  const sheetActions = {
    // Save keeps a draft; on a done set it is Update, an edit that keeps the set's time.
    onSave: async values => {
      const done = sheet.mode === 'done'
      settle(done ? await edit(sheet.setId, values) : await draft(sheet.setId, values), sheet.key, done ? 'edit' : 'draft')
    },
    onComplete: async values => settle(await complete({ setId: sheet.setId, side: sheet.side, values }), sheet.key, 'complete'),
    // Undo also clears a draft a failed clear left on the set, first, in the same gated write.
    onUndo: async () => settle(await write((view, now) => undoWrite(session, view, { setId: sheet.setId, eventId: createEventId(), now })), sheet.key, 'undo'),
    // Swiping the sheet away (or Close) after typing keeps a draft for any set not done yet; on a
    // done set it cancels. The sheet is gone, so a refusal shows on the screen.
    onClose: async (values, changed) => {
      closeSheet()
      if (sheetCloseCall(sheet.mode, changed) === 'draft') report(await draft(sheet.setId, values), 'draft')
    },
    // The app leaving the front with typed numbers keeps them as a draft through the same gate,
    // so a kill from the app switcher loses nothing. Numbers already kept are not written again
    // (the 'background' after an 'inactive'), so leaving holds the gate for one write. The sheet
    // stays open; a refusal shows in it while it is, else on the screen.
    onAppState: async (appState, values, changed) => {
      const stored = findSet(latest(), sheet.setId)?.slot.draft
      if (sheetBackgroundCall(appState, sheet.mode, changed, { values, stored }) !== 'draft') return
      const { key, setId } = sheet
      const text = resultNotice(await keepDraft(setId, values), 'draft')
      if (!text) return
      const notice = nextStamp()(text)
      if (openKey.current === key) setSheetNotice(notice)
      else setNotices(current => ({ ...current, notice }))
    },
  }

  // Add set and Add warm-up append a row to the exercise on screen; `callFor` builds it from the
  // engine's latest view.
  const addRow = (callFor, action) => async () => {
    if (!shownEntry) return
    report(await write(async (view, now) => {
      const call = callFor(view, shownEntry.id, createEventId(), now)
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
    onAddTime: async () => report(await write(() => session.extendRest({ eventId: createEventId(), byMs: 30_000 })), 'add-time'),
    onSkip: async () => report(await write(() => session.cancelRest({ eventId: createEventId() })), 'skip-rest'),
  }

  return {
    busy,
    notice: notices.notice?.text ?? null,
    // "Saved. Rest didn't start." (or why Start rest was refused), with its Start rest button.
    restNotice: notices.rest?.text ?? null,
    restoreRest,
    startRest: () => {
      if (!blockedOvernight()) startPendingRest('start-rest')
    },
    openSheet,
    addSet: addRow(addSetCall, 'add-set'),
    addWarmup: addRow(addWarmupCall, 'add-warmup'),
    resume: async () => report(await act(() => session.resume({ eventId: createEventId() })), 'resume'),
    dock: dockActions,
    sheet: { ...sheet, open: sheetOpen, notice: sheetNotice?.text ?? null, ...sheetActions },
    finish: {
      open: finishing != null,
      endsAtLastSet: finishing?.end != null,
      notice: finishNotice?.text ?? null,
      show: openFinish,
      close: () => setFinishing(null),
      confirm: async () => {
        const end = finishing?.end
        const result = await act(() => session.finishSession({ sender: async () => ({ saved: true }), ...(end != null ? { end } : {}) }))
        if (result?.ignored) return
        // Opened before midnight, saved after it: refused, and the view is reloaded. The sheet
        // takes the overnight end and says why; the next Save is the overnight Finish.
        const retarget = finishRetarget(result, end, latest())
        if (retarget) {
          setFinishing({ end: retarget.end })
          setFinishNotice(nextStamp()(retarget.notice))
          return
        }
        const text = resultNotice(result, 'finish')
        if (text) setFinishNotice(nextStamp()(text))
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
