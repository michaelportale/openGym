import { useEffect, useLayoutEffect, useRef } from 'react'
import { useUI } from '../store/useUI.js'
import { keyboardOpen } from '../lib/viewport-guard.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { ModalToastStatus } from './Toast.jsx'

// Putting the page back after a sheet closes takes up to three goes (see the un-pin below): now,
// next frame, and once the keyboard's dismiss animation is over. Anything else that wants to
// scroll in that same commit is overwritten. Rating a set closes the effort picker AND ticks the
// set in one tap, and the superset card's "bring the partner's row into view" was undone about
// 3 ms after it was asked for, every time. afterScrollRestore runs fn once the sequence is done,
// or straight away when none is running, and returns a canceller for the caller's effect cleanup.
//
// It does not get a timer of its own. Two ~350 ms timers armed a few milliseconds apart run in
// whichever order the browser likes, and on a phone the re-assert can come second and undo the
// scroll. So the last re-assert runs these itself, in its own timer callback, right after its own
// scrollTo: there is no ordering left to get wrong.
const RESTORE_MS = 350
let restoreUntil = 0
// Real closes, counted, so the last re-assert can tell whether it belongs to the latest one. That,
// not the clock, ends the sequence: with Date.now() coarsened or jittered (privacy.resistFingerprinting
// rounds it to 100 ms) a deadline read in that callback can still look a few ms away, and a waiter
// would then sit in the queue with nothing left to run it.
let closes = 0
let waiting = []
export function afterScrollRestore(fn) {
  if (!(restoreUntil - Date.now() > 0)) { fn(); return () => {} }
  waiting.push(fn)
  return () => { waiting = waiting.filter(x => x !== fn) }
}
// Whether that sequence is still running, for a scroll that would rather not happen at all than
// come after it: the superset card's scroll when the marker did not move (views/Workout.jsx) used
// to be undone by the restore on the spot, and skipping it keeps that exactly.
export const scrollRestorePending = () => restoreUntil - Date.now() > 0
// Called by the last re-assert of close number `close`, once it has had its say. Two reasons to
// leave the queue alone and let a later re-assert take it: a second sheet closed inside this window
// (its own last re-assert drains it), or the page is pinned again behind a newly opened sheet,
// where a scroll would be meaningless; that sheet's own un-pin comes with a fresh sequence.
const drainScrollRestore = close => {
  if (!close || close !== closes || document.body.style.position === 'fixed') return
  restoreUntil = 0
  const queue = waiting
  waiting = []
  for (const fn of queue) {
    try { fn() } catch (e) { /* one caller must not keep the others waiting */ }
  }
}

// Keep the existing sheet/scroll machinery, but give every surface the same modal boundary.
// The root is inside the React app, so inert only its siblings along the path to <body>, never
// an ancestor containing the dialog. Newly mounted sync/rest controls need the same boundary.
const FOCUSABLE = 'button, a[href], input, select, textarea, summary, [tabindex], [contenteditable="true"], video[controls], audio[controls]'
const firstSummary = details => [...details.children].find(child => child.tagName === 'SUMMARY')
const focusableIn = el => [...el.querySelectorAll(FOCUSABLE)].filter(node => {
  const nativeSummary = node.tagName === 'SUMMARY' && node.parentElement?.tagName === 'DETAILS'
    && firstSummary(node.parentElement) === node && !node.hasAttribute('tabindex')
  if ((!nativeSummary && node.tabIndex < 0) || node.matches(':disabled') || node.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  if (node.checkVisibility && !node.checkVisibility({ visibilityProperty: true })) return false
  for (let parent = node; parent && parent !== el; parent = parent.parentElement) {
    const style = window.getComputedStyle?.(parent)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse' || style?.contentVisibility === 'hidden') return false
    // Closed details can retain computed styles and cached rectangles for their hidden inputs.
    // Only the first summary (and controls inside it) participates in keyboard navigation.
    if (parent !== node && parent.tagName === 'DETAILS' && !parent.open && !firstSummary(parent)?.contains(node)) return false
  }
  return true
})
function useModalFocus(sheets, rootRef) {
  const openers = useRef(new Map())
  const fallback = useRef(null)
  const topId = sheets.at(-1)?.id
  // Capture before child autofocus runs during the commit, without overriding that autofocus.
  const entering = useRef({ id: null, element: null })
  if (entering.current.id !== topId) entering.current = { id: topId, element: document.activeElement }
  useLayoutEffect(() => {
    const modal = rootRef.current
    const dialog = modal?.lastElementChild?.querySelector('[role="dialog"]')
    if (!dialog || !topId) return
    const before = entering.current.element
    if (!openers.current.has(topId)) openers.current.set(topId,
      before?.isConnected && before !== document.body && !dialog.contains(before) ? before : fallback.current)
    const opener = openers.current.get(topId)
    const focusDialog = () => dialog.focus({ preventScroll: true })
    // Explicit caller autofocus (e.g. rename) is honored. Ordinary opening focuses the dialog,
    // not its first text field, so merely reviewing a sheet does not summon the keyboard.
    if (!dialog.contains(document.activeElement)) focusDialog()

    const hidden = new Map()
    const isolate = () => {
      for (let branch = modal; branch?.parentElement; branch = branch.parentElement) {
        for (const sibling of branch.parentElement.children) {
          if (sibling === branch || hidden.has(sibling)) continue
          hidden.set(sibling, { inert: sibling.hasAttribute('inert'), aria: sibling.getAttribute('aria-hidden') })
          sibling.setAttribute('inert', '')
          sibling.setAttribute('aria-hidden', 'true')
        }
        if (branch.parentElement === document.body) break
      }
    }
    isolate()
    const observer = typeof window.MutationObserver === 'function' ? new window.MutationObserver(isolate) : null
    observer?.observe(document.body, { childList: true, subtree: true })
    const onFocus = e => { if (!dialog.contains(e.target)) focusDialog() }
    const onTab = e => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const items = focusableIn(dialog), first = items[0], last = items.at(-1)
      const at = document.activeElement
      if (!items.length) { e.preventDefault(); focusDialog() }
      else if (e.shiftKey && (at === first || at === dialog || !dialog.contains(at))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (at === last || !dialog.contains(at))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('focusin', onFocus)
    window.addEventListener('keydown', onTab)
    return () => {
      observer?.disconnect()
      document.removeEventListener('focusin', onFocus)
      window.removeEventListener('keydown', onTab)
      for (const [node, prior] of hidden) {
        if (!prior.inert) node.removeAttribute('inert')
        if (prior.aria == null) node.removeAttribute('aria-hidden')
        else node.setAttribute('aria-hidden', prior.aria)
      }
      const next = useUI.getState().sheets
      if (!next.some(sheet => sheet.id === topId)) {
        const nextDialog = rootRef.current?.lastElementChild?.querySelector('[role="dialog"]')
        // closeAll can remove the nested opener too. Walk back to a connected ancestor opener;
        // replacing a sheet inherits that same target rather than a now-detached confirm button.
        const target = [opener, ...[...openers.current.values()].reverse(), fallback.current]
          .find(node => node?.isConnected && (nextDialog?.contains(node) || !modal.contains(node))) || opener
        fallback.current = target
        for (const id of openers.current.keys()) if (!next.some(sheet => sheet.id === id)) openers.current.delete(id)
        // Never focus a detached trigger or focus the page through a still-open modal.
        if (target?.isConnected && (!next.length || nextDialog?.contains(target))) target.focus({ preventScroll: true })
      }
    }
  }, [topId])
}

// One bottom sheet (or centered dialog) with swipe-to-dismiss.
function Sheet({ sheet, active }) {
  const { closeSheet } = useUI()
  const ref = useRef(null)
  const dialogRef = useRef(null)
  useLayoutEffect(() => {
    const el = dialogRef.current
    const heading = el?.querySelector('h1, h2, h3, [role="heading"]')
    if (!heading) return
    if (!heading.id) heading.id = `sheet-title-${sheet.id}`
    el.setAttribute('aria-labelledby', heading.id)
  }, [sheet.id])
  const semantics = { role: 'dialog', 'aria-modal': active ? true : undefined, 'aria-label': t('Details'), tabIndex: -1 }
  const layer = { inert: active ? undefined : true, 'aria-hidden': active ? undefined : true }
  // startY null = no gesture. axis stays null until the finger has travelled far enough to
  // tell a vertical pull from a sideways scroll; 'x' hands the gesture to whatever scrolls
  // horizontally under it (chip strips, heatmap) and the sheet stays put.
  const idle = () => ({ startX: null, startY: null, axis: null, delta: 0, vy: 0, lastY: 0, lastT: 0 })
  const drag = useRef(idle())

  // a gesture that begins on a slider (or opted-out control) belongs to that control, not to
  // the sheet's swipe-to-dismiss — so it keeps working while you drag. Horizontal strips are
  // opted out too: a sideways scroll must never wobble or pull down the sheet.
  const NODRAG = 'input[type=range], [data-nodrag], .chips, .hm-wrap'
  const begin = (target, x, y) => {
    const el = ref.current
    if (target.closest && target.closest(NODRAG)) { drag.current = idle(); return }
    if (el.scrollTop > 0) { drag.current = idle(); return }
    drag.current = { ...idle(), startX: x, startY: y, lastY: y, lastT: performance.now() }
  }
  const move = (e, x, y) => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    // synthetic events (tests) may carry no x at all: treat that as straight down
    const dx = Number.isFinite(x) ? x - d.startX : 0, dy = y - d.startY
    if (d.axis === null) {
      // axis lock after ~8px: clearly-more-vertical wins the sheet, anything else is a scroll
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      d.axis = Math.abs(dy) > Math.abs(dx) * 1.2 ? 'y' : 'x'
      if (d.axis === 'x') return
    }
    if (d.axis === 'x') return
    const now = performance.now()
    // velocity from the last move, so a fast short flick can still be told from a slow drag
    if (now > d.lastT) { d.vy = (y - d.lastY) / (now - d.lastT); d.lastY = y; d.lastT = now }
    if (dy > 0 && el.scrollTop <= 0) {
      e.preventDefault()
      d.delta = dy
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
    } else if (d.delta > 0) {
      // the pull reversed above the start: snap back before the sheet is allowed to scroll,
      // otherwise it scrolls while still hanging below its resting place
      e.preventDefault()
      d.delta = 0
      el.style.transform = 'translateY(0px)'
    }
  }
  const onTouchStart = e => begin(e.target, e.touches[0].clientX, e.touches[0].clientY)
  const onTouchMove = e => move(e, e.touches[0].clientX, e.touches[0].clientY)
  const onTouchEnd = () => {
    const el = ref.current, d = drag.current
    if (d.startY === null) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.style.transition = still ? 'none' : 'transform .2s'
    // a long pull, or a short but fast flick, dismisses
    const flick = d.delta > 30 && d.vy > 0.6
    if ((d.delta > 90 || flick) && !sheet.locked) {
      if (still) closeSheet(sheet.id)
      else { el.style.transform = 'translateY(110%)'; setTimeout(() => closeSheet(sheet.id), 180) }
    }
    else el.style.transform = ''
    drag.current = idle()
  }
  // Mouse drag (desktop testing / trackpads): same swipe-to-dismiss behaviour.
  const onMouseDown = e => { if (e.button === 0) begin(e.target, e.clientX, e.clientY) }
  const onMouseMove = e => move(e, e.clientX, e.clientY)
  const onMouseUp = () => onTouchEnd()

  // non-passive touchmove so preventDefault works (bottom sheets only; centered dialogs have no ref)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      el.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [sheet.id, sheet.locked])

  const close = () => closeSheet(sheet.id)
  const dismiss = !sheet.locked && <div className="modal-dismiss" data-nodrag>
    <button type="button" className="btn ghost modal-close" aria-label={t('Close')} onClick={close}>
      <Icon name="xmark" />{t('Close')}
    </button>
  </div>
  // Full screen, on black: a photo or video opened from a workout (WorkoutMedia.jsx). No
  // backdrop to tap, no drag to dismiss — the viewer has its own close button, and back closes
  // it like any sheet.
  if (sheet.kind === 'viewer') return <div {...layer}>{sheet.render(close)}</div>
  if (sheet.kind === 'center') {
    return (
      <div {...layer}>
        <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
        <div className="center" ref={dialogRef} {...semantics}>{dismiss}{sheet.render(close)}{active && <ModalToastStatus />}</div>
      </div>
    )
  }
  return (
    <div {...layer}>
      <div className="mback" onClick={() => { if (!sheet.locked) close() }} />
      <div className="sheet" ref={el => { ref.current = el; dialogRef.current = el }} {...semantics} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        {dismiss || <div className="grab" aria-hidden="true" />}
        {sheet.render(close)}
        {active && <ModalToastStatus />}
      </div>
    </div>
  )
}

export default function Modals() {
  const sheets = useUI(s => s.sheets)
  const closeSheet = useUI(s => s.closeSheet)
  const prevLen = useRef(0)
  const suppressPop = useRef(false)
  const pushedEntries = useRef(0)
  const sheetEntries = useRef([])
  const modalRef = useRef(null)
  useModalFocus(sheets, modalRef)

  // Every opened sheet gets a history entry so Android back dismisses it instead of
  // leaving the page (issue #63). Keep the pushed-entry count and each active sheet's
  // live-entry status explicit: sheet count cannot tell whether popstate already spent
  // an entry (especially for a locked sheet) or whether several sheets opened at once.
  useEffect(() => {
    const prev = prevLen.current
    prevLen.current = sheets.length
    if (sheets.length > prev) {
      for (let i = prev; i < sheets.length; i++) {
        sheetEntries.current.push({ openedAt: location.href, live: true })
        history.pushState({ openGymSheet: true }, '')
        pushedEntries.current++
      }
    } else if (sheets.length < prev) {
      const closedEntries = sheetEntries.current.splice(sheets.length, prev - sheets.length)
      const rewind = closedEntries.filter(entry =>
        entry.live && !(typeof entry.openedAt === 'string' && location.href !== entry.openedAt)).length
      if (rewind > 0) {
        pushedEntries.current = Math.max(0, pushedEntries.current - rewind)
        suppressPop.current = true
        history.go(-rewind)
      }
      // Entries skipped because the app moved on remain in pushedEntries as deliberate
      // leaks until a later popstate consumes them with no corresponding active sheet.
    }
  }, [sheets.length])

  useEffect(() => {
    const onPop = () => {
      if (suppressPop.current) { suppressPop.current = false; return }
      if (pushedEntries.current <= 0) return
      pushedEntries.current--
      // The browser has already spent one pushed entry. Mark the latest live active
      // sheet entry spent even when the sheet is locked; with no active entry this is a
      // moved-on leak, which is still accounted for by the counter decrement above.
      for (let i = sheetEntries.current.length - 1; i >= 0; i--) {
        if (sheetEntries.current[i].live) {
          sheetEntries.current[i].live = false
          break
        }
      }
      const top = sheets[sheets.length - 1]
      if (top && !top.locked) closeSheet(top.id)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [sheets, closeSheet])

  // lock the page behind any open sheet (iOS-safe)
  useEffect(() => {
    if (!sheets.length) return
    const onKey = e => { if (e.key === 'Escape') { const top = useUI.getState().sheets[useUI.getState().sheets.length - 1]; if (top && !top.locked) useUI.getState().closeSheet(top.id) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheets.length])
  // A layout effect, not a passive one: the pin and, above all, the un-pin plus the scroll
  // restore have to land in the same frame as the sheet's own mount/unmount. Run after paint,
  // iOS showed a frame with the body un-pinned at scroll 0 — the page "jumped down and back" on
  // every RIR pick, which closes the sheet and starts a rest in one tap (2026-09-18).
  useLayoutEffect(() => {
    if (!sheets.length) return
    // A text field on the page behind (a set's weight, the Library search) keeps focus when a
    // button opens a sheet — WebKit does not blur on button taps — and its keyboard then
    // stays up under the sheet, or leaves the viewport displaced when it finally goes. The
    // sheet owns the screen now; a field inside the sheet (the picker search) is left alone.
    const a = document.activeElement
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && !a.closest?.('#modal-root')) a.blur?.()
    const y = window.scrollY || 0
    const b = document.body.style
    b.position = 'fixed'; b.top = -y + 'px'; b.left = '0'; b.right = '0'; b.width = '100%'
    return () => {
      // A workout layout change can move the anchor while this sheet is open.
      const restoreY = -(parseFloat(b.top) || 0)
      b.position = b.top = b.left = b.right = b.width = ''
      // Tell anything that scrolls for its own reasons how long this will go on (afterScrollRestore),
      // but only when a sheet really did close. React StrictMode runs this cleanup immediately after
      // the effect when Modals mounts with a sheet already up, and arming the window there would make
      // anything waiting on the restore wait RESTORE_MS for a page nobody is putting back: late in
      // dev, on time in production. In production this cleanup runs on the close path alone.
      const close = useUI.getState().sheets.length ? 0 : ++closes
      if (close) restoreUntil = Date.now() + RESTORE_MS
      window.scrollTo(0, restoreY)
      // iOS scrolls asynchronously; a restore issued in the same task as the un-pin can be applied
      // a frame late or against the still-short layout. Say it once more on the next frame.
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => { if (document.body.style.position !== 'fixed') window.scrollTo(0, restoreY) })
      // If the sheet closed with the keyboard still up (tap "+" in the picker, then finish),
      // iOS scrolls the page again while the keyboard dismisses — after the line above ran.
      // Ask once more when that animation is over. The window-level guard in
      // lib/viewport-guard.js covers the keyboard closing while a sheet stays open.
      // This last one also hands the page over to anything that has been waiting for the sequence
      // to finish (afterScrollRestore), in this same callback, right after its own scrollTo, so a
      // scroll of someone else's cannot be undone by a re-assert still to come.
      //
      // The re-assert itself is for the keyboard case only: without one there is nothing to undo,
      // and a late restore would overwrite a scroll the page behind made on purpose because the
      // sheet closed — the workout list going to the current exercise after ⋯ → Layout → List
      // (issue #224). At this point the sheet's field is already out of the DOM but the keyboard
      // has not started to go, so the visual viewport still tells the truth. The timer is armed
      // either way, because the hand-over is the only thing that drains the queue.
      //
      // A workout list that collapsed a finished exercise while the sheet was up has already put
      // its own anchor back (WorkoutScrollAnchor); it says so, and the re-assert stands down.
      const hadKeyboard = keyboardOpen()
      let anchored = false
      const onAnchor = () => { anchored = true }
      window.addEventListener('workout-scroll-anchor', onAnchor, { once: true })
      window.setTimeout(() => {
        window.removeEventListener('workout-scroll-anchor', onAnchor)
        if (hadKeyboard && !anchored && document.body.style.position !== 'fixed') window.scrollTo(0, restoreY)
        drainScrollRestore(close)
      }, RESTORE_MS)
    }
  }, [sheets.length > 0])

  if (!sheets.length) return null
  return (
    <div id="modal-root" className="open" ref={modalRef}>
      {sheets.map((s, i) => <Sheet key={s.id} sheet={s} active={i === sheets.length - 1} />)}
    </div>
  )
}
