import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modals, { afterScrollRestore, scrollRestorePending } from './Modals.jsx'

const mocks = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    sheets: [],
    closeSheet(id) {
      state.sheets = state.sheets.filter(sheet => sheet.id !== id)
      listeners.forEach(listener => listener())
    },
  }
  return {
    state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setSheets(sheets) {
      state.sheets = sheets
      listeners.forEach(listener => listener())
    },
  }
})

vi.mock('../store/useUI.js', async () => {
  const React = await import('react')
  const useUI = (selector = state => state) => React.useSyncExternalStore(
    mocks.subscribe,
    () => selector(mocks.state),
    () => selector(mocks.state),
  )
  useUI.getState = () => mocks.state
  return { useUI }
})

let dom
let root
let container
let historyMock
let locationMock

function sheet(id, { locked = false, render = () => React.createElement('div') } = {}) {
  return { id, locked, kind: 'sheet', render }
}

function installDom(focus = false) {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = focus ? new Window({ url: 'https://opengym.test/#/workout' }) : parsed.window
  if (focus) dom.document.body.innerHTML = '<div id="root"></div>'
  dom.scrollTo = vi.fn()
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event']) globalThis[key] = dom[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  locationMock = { href: 'https://opengym.test/#/workout' }
  historyMock = { pushState: vi.fn(), go: vi.fn() }
  Object.defineProperty(globalThis, 'location', { configurable: true, value: locationMock })
  Object.defineProperty(globalThis, 'history', { configurable: true, value: historyMock })

  container = document.getElementById('root')
  root = createRoot(container)
}

async function setSheets(sheets) {
  await act(async () => { mocks.setSheets(sheets) })
}

async function popstate() {
  await act(async () => { window.dispatchEvent(new dom.Event('popstate')) })
}

function mouse(target, type, clientY, clientX = 0) {
  const event = new dom.Event(type, { bubbles: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  target.dispatchEvent(event)
}

beforeEach(async () => {
  mocks.state.sheets = []
  installDom()
  await act(async () => { root.render(React.createElement(Modals)) })
})

afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  root = null
  container = null
  dom = null
  vi.restoreAllMocks()
})

describe('Modals sheet history accounting', () => {
  it('does not rewind a real page after back spends a locked FinishSummary entry', async () => {
    const confirm = sheet('confirm')
    const summary = sheet('summary', { locked: true })

    await setSheets([confirm])
    expect(historyMock.pushState).toHaveBeenCalledTimes(1)

    // ConfirmDialog closes and FinishSummary opens in the same batch: length remains one,
    // so the existing pushed entry now belongs to the locked summary.
    await setSheets([summary])
    await popstate()
    expect(mocks.state.sheets).toEqual([summary])

    await act(async () => { mocks.state.closeSheet('summary') })
    expect(historyMock.go).not.toHaveBeenCalled()
  })

  it('pushes and rewinds the exact number of entries for batched sheets', async () => {
    await setSheets([sheet('one'), sheet('two')])
    expect(historyMock.pushState).toHaveBeenCalledTimes(2)

    await setSheets([])
    expect(historyMock.go).toHaveBeenCalledTimes(1)
    expect(historyMock.go).toHaveBeenCalledWith(-2)
  })

  it('closes stacked sheets one entry at a time on back', async () => {
    await setSheets([sheet('one'), sheet('two')])
    await popstate()

    expect(mocks.state.sheets.map(item => item.id)).toEqual(['one'])
    expect(historyMock.pushState).toHaveBeenCalledTimes(2)

    await popstate()
    expect(mocks.state.sheets).toEqual([])
    expect(historyMock.go).not.toHaveBeenCalled()
  })

  it('closes an unlocked sheet on back without rewinding its already-spent entry', async () => {
    await setSheets([sheet('open')])
    await popstate()

    expect(mocks.state.sheets).toEqual([])
    expect(historyMock.go).not.toHaveBeenCalled()
  })

  it('accounts for a moved-on entry even when popstate has no current sheet', async () => {
    await setSheets([sheet('navigating')])
    locationMock.href = 'https://opengym.test/#/home'
    await setSheets([])
    expect(historyMock.go).not.toHaveBeenCalled()

    // This spends the deliberately leaked entry with top === undefined.
    await popstate()

    const locked = sheet('locked', { locked: true })
    await setSheets([locked])
    await popstate()
    await setSheets([])
    expect(historyMock.go).not.toHaveBeenCalled()
  })
})

describe('Modals scroll restoration', () => {
  it('uses the body offset corrected by a workout layout change', async () => {
    await setSheets([sheet('layout')])
    document.body.style.top = '-240px'
    await setSheets([])
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 240)
  })

  it('does not undo a newer workout scroll anchor with its delayed keyboard restore', async () => {
    vi.useFakeTimers()
    try {
      await setSheets([sheet('layout')])
      document.body.style.top = '-800px'
      await setSheets([])
      window.scrollTo.mockClear()
      window.dispatchEvent(new dom.Event('workout-scroll-anchor'))
      await act(async () => { vi.advanceTimersByTime(350) })
      expect(window.scrollTo).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

describe('Modals mouse dragging', () => {
  it('leaves range sliders opted out of sheet dragging', async () => {
    await setSheets([sheet('slider', {
      render: () => React.createElement('input', { type: 'range' }),
    })])
    const sheetEl = container.querySelector('.sheet')
    const slider = container.querySelector('input[type="range"]')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(slider, 'mousedown', 10)
      mouse(sheetEl, 'mousemove', 150)
      window.dispatchEvent(new dom.Event('mouseup'))
    })

    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })

  it('releases a drag when mouseup occurs outside the sheet', async () => {
    // a slow pull: synthetic events fire in the same tick, which would read as a flick
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await setSheets([sheet('drag')])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(sheetEl, 'mousedown', 10)
      now = 300; mouse(sheetEl, 'mousemove', 60)
    })
    expect(sheetEl.style.transform).toBe('translateY(50px)')

    await act(async () => { window.dispatchEvent(new dom.Event('mouseup')) })
    expect(sheetEl.style.transform).toBe('')

    await act(async () => { mouse(sheetEl, 'mousemove', 120) })
    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })
})

describe('Modals drag axis lock and dismiss', () => {
  it('ignores a sideways gesture instead of wobbling the sheet', async () => {
    await setSheets([sheet('x')])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(sheetEl, 'mousedown', 10, 10)
      mouse(sheetEl, 'mousemove', 20, 60)
      // once locked to x, even a clearly downward move stays with the horizontal gesture
      mouse(sheetEl, 'mousemove', 120, 70)
      window.dispatchEvent(new dom.Event('mouseup'))
    })
    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })

  it('leaves horizontal chip strips to their own scrolling', async () => {
    await setSheets([sheet('chips', {
      render: () => React.createElement('div', { className: 'chips' }, React.createElement('button', { className: 'chip' }, 'a')),
    })])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(container.querySelector('.chip'), 'mousedown', 10)
      mouse(sheetEl, 'mousemove', 150)
      window.dispatchEvent(new dom.Event('mouseup'))
    })
    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })

  it('snaps back to zero when the pull reverses instead of scrolling while offset', async () => {
    await setSheets([sheet('rev')])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(sheetEl, 'mousedown', 10)
      mouse(sheetEl, 'mousemove', 110)
    })
    expect(sheetEl.style.transform).toBe('translateY(100px)')

    await act(async () => { mouse(sheetEl, 'mousemove', 5) })
    expect(sheetEl.style.transform).toBe('translateY(0px)')

    await act(async () => { window.dispatchEvent(new dom.Event('mouseup')) })
    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })

  it('dismisses on a short but fast flick', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await setSheets([sheet('flick')])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(sheetEl, 'mousedown', 10)
      now = 20; mouse(sheetEl, 'mousemove', 40)
      now = 60; mouse(sheetEl, 'mousemove', 80)   // 70px in 60ms: ~1 px/ms
      window.dispatchEvent(new dom.Event('mouseup'))
    })
    expect(sheetEl.style.transform).toBe('translateY(110%)')
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(mocks.state.sheets).toHaveLength(0)
    vi.useRealTimers()
  })

  it('keeps a short slow pull open', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await setSheets([sheet('slow')])
    const sheetEl = container.querySelector('.sheet')
    sheetEl.scrollTop = 0

    await act(async () => {
      mouse(sheetEl, 'mousedown', 10)
      now = 400; mouse(sheetEl, 'mousemove', 80)
      window.dispatchEvent(new dom.Event('mouseup'))
    })
    expect(sheetEl.style.transform).toBe('')
    expect(mocks.state.sheets).toHaveLength(1)
  })
})

describe('Modals scroll restore on close', () => {
  // The body is pinned while a sheet is open and the page is put back where it was on close.
  // The second, delayed restore exists for one reason — iOS scrolling the page again while the
  // keyboard dismisses — so it must only be armed when the keyboard is actually up (QA C1).
  async function openAndClose() {
    dom.scrollY = 320
    await setSheets([sheet('menu')])
    expect(document.body.style.position).toBe('fixed')
    dom.scrollTo.mockClear()
    await setSheets([])
  }

  it('restores the position once and leaves a scroll the page made afterwards alone', async () => {
    vi.useFakeTimers()
    await openAndClose()
    expect(dom.scrollTo).toHaveBeenCalledTimes(1)
    expect(dom.scrollTo).toHaveBeenCalledWith(0, 320)
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(dom.scrollTo).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('restores again after the keyboard dismiss animation when the sheet closed with the keyboard up', async () => {
    vi.useFakeTimers()
    dom.innerHeight = 800
    dom.visualViewport = { height: 460 }
    await openAndClose()
    expect(dom.scrollTo).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(dom.scrollTo).toHaveBeenCalledTimes(2)
    expect(dom.scrollTo).toHaveBeenLastCalledWith(0, 320)
    vi.useRealTimers()
  })
})

// The page behind a sheet is pinned (body fixed, shifted by the scroll position) and put back
// where it was when the sheet goes — in the same commit, so there is no frame at scroll 0.
describe('pinning the page behind a sheet', () => {
  it('pins on open with the scroll position folded in, and restores it on close, three times over', async () => {
    vi.useFakeTimers()
    // the sheet closes with the keyboard still up, so the 350 ms restore is armed too (QA C1)
    dom.innerHeight = 800
    dom.visualViewport = { height: 460 }
    Object.defineProperty(dom, 'scrollY', { configurable: true, value: 343 })
    const rafs = []
    dom.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length }
    await setSheets([sheet('a')])
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-343px')
    expect(dom.scrollTo).not.toHaveBeenCalled()
    await setSheets([])
    expect(document.body.style.position).toBe('')
    expect(dom.scrollTo).toHaveBeenCalledTimes(1)              // at once, in the same commit
    expect(dom.scrollTo).toHaveBeenCalledWith(0, 343)
    rafs.forEach(fn => fn())
    expect(dom.scrollTo).toHaveBeenCalledTimes(2)              // again on the next frame (iOS scrolls asynchronously)
    vi.advanceTimersByTime(400)
    expect(dom.scrollTo).toHaveBeenCalledTimes(3)              // and after the keyboard's dismiss animation
    vi.useRealTimers()
  })

  // Rating a set closes the effort picker AND ticks it in one tap, so the superset card's own
  // "bring the partner's row into view" is asked for in the same commit as the restore, and the
  // re-assert overwrote it a few ms later, every time. Anything scrolling for its own reasons
  // waits for the restores, and then has the last word.
  it('hands a scroll of its own over the moment the restores are done, and not a frame before', async () => {
    vi.useFakeTimers()
    dom.innerHeight = 800
    dom.visualViewport = { height: 800 }                       // no keyboard: a menu sheet
    Object.defineProperty(dom, 'scrollY', { configurable: true, value: 974 })
    const rafs = []
    dom.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length }
    await setSheets([sheet('effort-picker')])
    await setSheets([])                                        // the pick closes it and ticks the set
    expect(scrollRestorePending()).toBe(true)

    // The order is the whole point, so record it rather than counting: the handed-over scroll must
    // come STRICTLY after the last restore. Equal-time is a fail; on a phone that is a coin toss.
    const order = []
    dom.scrollTo.mockImplementation(() => order.push('scrollTo'))
    afterScrollRestore(() => order.push('handed over'))
    expect(order).toEqual([])                                  // not while the page is being put back
    rafs.forEach(fn => fn())
    expect(order).toEqual(['scrollTo'])                        // the next-frame re-assert, alone
    vi.advanceTimersByTime(400)
    expect(order).toEqual(['scrollTo', 'handed over'])         // no keyboard, so no late re-assert
    expect(order.indexOf('handed over')).toBeGreaterThan(order.lastIndexOf('scrollTo'))
    expect(scrollRestorePending()).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(order.at(-1)).toBe('handed over')                   // and nothing undoes it afterwards
    vi.useRealTimers()
  })

  it('hands over after the late re-assert when the sheet closed with the keyboard up', async () => {
    vi.useFakeTimers()
    dom.innerHeight = 800
    dom.visualViewport = { height: 460 }
    Object.defineProperty(dom, 'scrollY', { configurable: true, value: 974 })
    const rafs = []
    dom.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length }
    await setSheets([sheet('effort-picker')])
    await setSheets([])
    const order = []
    dom.scrollTo.mockImplementation(() => order.push('scrollTo'))
    afterScrollRestore(() => order.push('handed over'))
    rafs.forEach(fn => fn())
    vi.advanceTimersByTime(400)
    expect(order).toEqual(['scrollTo', 'scrollTo', 'handed over'])
    vi.useRealTimers()
  })

  it('waits for a second sheet that closes inside the first one\'s window', async () => {
    vi.useFakeTimers()
    Object.defineProperty(dom, 'scrollY', { configurable: true, value: 974 })
    let rafs = []
    dom.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length }
    await setSheets([sheet('one')])
    await setSheets([])
    const order = []
    dom.scrollTo.mockImplementation(() => order.push('scrollTo'))
    afterScrollRestore(() => order.push('handed over'))
    vi.advanceTimersByTime(200)
    await setSheets([sheet('two')])                            // and another one closes
    await setSheets([])
    rafs.forEach(fn => fn()); rafs = []
    vi.advanceTimersByTime(160)                                // past the FIRST deadline
    expect(order).not.toContain('handed over')                 // the sequence moved; so does the queue
    vi.advanceTimersByTime(200)                                // past the second one
    expect(order.at(-1)).toBe('handed over')
    expect(order.indexOf('handed over')).toBeGreaterThan(order.lastIndexOf('scrollTo'))
    vi.advanceTimersByTime(1000)
    expect(order.filter(x => x === 'handed over')).toHaveLength(1)
    vi.useRealTimers()
  })

  // A clock that reads coarse (privacy.resistFingerprinting rounds Date.now to 100 ms) can make
  // the last re-assert look early against the deadline. The hand-over happens there all the same,
  // and nothing asked for after it is left waiting for a close that is over.
  it('hands over on the last re-assert even when the clock reads behind the deadline', async () => {
    vi.useFakeTimers()
    dom.innerHeight = 800
    dom.visualViewport = { height: 800 }
    Object.defineProperty(dom, 'scrollY', { configurable: true, value: 974 })
    dom.requestAnimationFrame = () => 0
    await setSheets([sheet('effort-picker')])
    await setSheets([])
    const ran = vi.fn()
    afterScrollRestore(ran)
    vi.setSystemTime(Date.now() - 100)                         // the clock now reads 100 ms behind
    vi.advanceTimersByTime(360)
    expect(ran).toHaveBeenCalledTimes(1)
    expect(scrollRestorePending()).toBe(false)
    const later = vi.fn()
    afterScrollRestore(later)
    expect(later).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('runs a scroll of its own straight away when no sheet is closing', async () => {
    vi.useFakeTimers()
    vi.advanceTimersByTime(1000)                               // whatever closed earlier is long done
    expect(scrollRestorePending()).toBe(false)
    const ran = vi.fn()
    afterScrollRestore(ran)
    expect(ran).toHaveBeenCalledTimes(1)                       // the plain checkbox tick's path
    vi.useRealTimers()
  })
})

// The scroll-restore window says "the page is being put back, wait your turn". It belongs to the
// close path alone. StrictMode (dev) runs the pin/un-pin layout effect twice when Modals mounts
// with a sheet already open, and the cleanup in between looked exactly like a close, so anything
// waiting on the restore (the superset card's scroll, views/Workout.jsx) sat out 350 ms for a
// page nobody was putting back. In dev only.
describe('the restore window under StrictMode', () => {
  it('is not armed by a sheet opening, and still is by one closing', async () => {
    vi.useFakeTimers()
    vi.advanceTimersByTime(1000)                               // whatever ran earlier is long done
    await act(async () => { root.unmount() })
    root = createRoot(container)
    const rafs = []
    dom.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length }

    // Mounting with a sheet already up is the path StrictMode double-invokes: effect, cleanup,
    // effect, all in the one commit, with the sheet open throughout.
    mocks.state.sheets = [sheet('already-open')]
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Modals))) })
    expect(document.body.style.position).toBe('fixed')         // the page is pinned, not restoring

    const onOpen = vi.fn()
    afterScrollRestore(onOpen)
    expect(onOpen).toHaveBeenCalledTimes(1)                    // so a scroll of its own runs now

    await setSheets([])
    const onClose = vi.fn()
    afterScrollRestore(onClose)
    expect(onClose).not.toHaveBeenCalled()                     // and a real close still holds it
    vi.advanceTimersByTime(400)
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})


// Use a DOM with native focus behavior for these keyboard contracts; linkedom intentionally
// supplies only the structural DOM needed by the scrolling/history regressions above.
describe('modal focus and screen-reader boundaries', () => {
  beforeEach(async () => {
    await act(async () => { root.unmount() })
    installDom(true)
    await act(async () => { root.render(React.createElement(Modals)) })
  })

  function trigger() {
    const button = document.createElement('button')
    button.textContent = 'Replace exercise'
    container.prepend(button)
    button.focus()
    return button
  }
  const dialogSheet = (id, title = 'Replace exercise', options = {}) => sheet(id, {
    ...options,
    render: () => <><h3>{title}</h3><button>First</button><button disabled>Unavailable</button>
      <button hidden>Hidden</button><button tabIndex={-1}>Outside tab order</button><button>Last</button></>,
  })
  const keys = async (key, shiftKey = false) => {
    const event = new dom.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
    await act(async () => { document.activeElement.dispatchEvent(event) })
    return event
  }

  it('names and focuses the dialog without opening an input keyboard, then returns to its opener', async () => {
    const opener = trigger()
    await setSheets([dialogSheet('replace')])
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Replace exercise')
    expect(document.activeElement).toBe(dialog)
    await setSheets([])
    expect(document.activeElement).toBe(opener)
  })

  it.each(['sheet', 'center'])('offers an explicit Close button in an unlocked %s', async kind => {
    const opener = trigger()
    await setSheets([{ ...dialogSheet('close', 'Finish workout'), kind }])
    const close = container.querySelector('[role="dialog"] .modal-close')
    expect(close?.getAttribute('aria-label')).toBe('Close')
    expect(close.textContent).toContain('Close')
    await act(async () => { close.click() })
    expect(mocks.state.sheets).toEqual([])
    expect(document.activeElement).toBe(opener)
  })

  it('closes only the top sheet by touch and returns to the nested opener', async () => {
    trigger()
    const parent = dialogSheet('parent', 'Workout options')
    await setSheets([parent])
    const first = container.querySelector('[role="dialog"]')
    const opener = [...first.querySelectorAll('button')].find(button => button.textContent === 'First')
    opener.focus()
    await setSheets([parent, dialogSheet('effort', 'Final working set RIR')])
    const dialogs = container.querySelectorAll('[role="dialog"]')
    await act(async () => { dialogs[1].querySelector('.modal-close').click() })
    expect(mocks.state.sheets.map(s => s.id)).toEqual(['parent'])
    expect(document.activeElement).toBe(opener)
    expect(new Set([...container.querySelectorAll('[id]')].map(node => node.id)).size)
      .toBe(container.querySelectorAll('[id]').length)
  })

  it('keeps locked confirmations locked and does not duplicate viewer controls', async () => {
    trigger()
    await setSheets([dialogSheet('locked', 'Workout saved', { locked: true })])
    expect(container.querySelector('.modal-close')).toBeNull()
    await setSheets([{ ...sheet('viewer', { render: () => <div role="dialog" tabIndex={-1}><button>Viewer close</button></div> }), kind: 'viewer' }])
    expect(container.querySelector('.modal-close')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(2) // original trigger plus viewer control
  })

  it('contains forward/backward keyboard traversal and ignores non-tabbable controls', async () => {
    trigger()
    await setSheets([dialogSheet('replace')])
    const dialog = container.querySelector('[role="dialog"]')
    const first = dialog.querySelector('.modal-close')
    const last = [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Last')
    expect((await keys('Tab', true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
    expect((await keys('Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)
    expect((await keys('Tab', true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)
  })

  it('wraps through a native summary when replacement search has no results and stations are collapsed', async () => {
    trigger()
    await setSheets([sheet('replacements', { render: () => <>
      <h3>Swap exercise</h3><input aria-label="Search exercises" />
      <button>Suggested replacements</button><button>All</button>
      <details><summary>Occupied stations</summary><label><input type="checkbox" />Cable station</label></details>
      <p>No replacements in this view.</p>
    </> })])
    const dialog = container.querySelector('[role="dialog"]')
    const close = dialog.querySelector('.modal-close'), summary = dialog.querySelector('summary')
    close.focus()
    expect((await keys('Tab', true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(summary)
    expect((await keys('Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    // Opening the disclosure makes the station checkbox the true end of the keyboard order.
    dialog.querySelector('details').open = true
    await keys('Tab', true)
    expect(document.activeElement).toBe(dialog.querySelector('input[type="checkbox"]'))
    await keys('Tab')
    expect(document.activeElement).toBe(close)
  })

  it('excludes nested disclosure controls hidden by a closed ancestor', async () => {
    trigger()
    await setSheets([sheet('nested-details', { render: () => <><h3>Station filters</h3>
      <details><summary>Occupied stations</summary><details open><summary>Nested station group</summary>
        <button>Hidden station</button></details></details>
    </> })])
    const dialog = container.querySelector('[role="dialog"]')
    dialog.querySelector('.modal-close').focus()
    await keys('Tab', true)
    expect(document.activeElement).toBe(dialog.querySelector('summary'))
  })

  it('excludes an explicitly untabbable summary and controls hidden by rendering styles', async () => {
    trigger()
    await setSheets([sheet('hidden-controls', { render: () => <><h3>Filters</h3><input aria-label="Search" />
      <details><summary tabIndex={-1}>Not in tab order</summary><button>Hidden station</button></details>
      <div style={{ display: 'none' }}><button>Not rendered</button></div>
      <div style={{ contentVisibility: 'hidden' }}><button>Skipped content</button></div>
    </> })])
    const dialog = container.querySelector('[role="dialog"]')
    dialog.querySelector('.modal-close').focus()
    await keys('Tab', true)
    expect(document.activeElement).toBe(dialog.querySelector('input'))
  })

  it('makes the workout, rest and sync background inert and restores prior attributes', async () => {
    const opener = trigger()
    const timer = document.createElement('section')
    timer.id = 'timer'; timer.setAttribute('aria-hidden', 'false')
    container.appendChild(timer)
    await setSheets([dialogSheet('replace')])
    expect(opener.hasAttribute('inert')).toBe(true)
    expect(timer.getAttribute('aria-hidden')).toBe('true')
    const sync = document.createElement('section')
    sync.id = 'sync'; container.appendChild(sync)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(sync.hasAttribute('inert')).toBe(true)
    await setSheets([])
    expect(opener.hasAttribute('inert')).toBe(false)
    expect(timer.getAttribute('aria-hidden')).toBe('false')
    expect(sync.hasAttribute('inert')).toBe(false)
    expect(sync.hasAttribute('aria-hidden')).toBe(false)
  })

  it('keeps lower sheets inactive and returns through the correct nested opener', async () => {
    const opener = trigger()
    const firstSheet = dialogSheet('first', 'Workout options')
    await setSheets([firstSheet])
    const lower = container.querySelector('[role="dialog"]')
    const innerOpener = lower.querySelector('button')
    innerOpener.focus()
    await setSheets([firstSheet, dialogSheet('second', 'Final set effort')])
    expect(lower.closest('[inert]')).not.toBeNull()
    expect(lower.getAttribute('aria-modal')).toBeNull()
    await keys('Escape')
    expect(document.activeElement).toBe(innerOpener)
    expect(lower.closest('[inert]')).toBeNull()
    await keys('Escape')
    expect(document.activeElement).toBe(opener)
  })

  it('returns to the original page trigger when the whole modal stack closes at once', async () => {
    const opener = trigger()
    const first = dialogSheet('first')
    await setSheets([first])
    container.querySelector('[role="dialog"] button').focus()
    await setSheets([first, dialogSheet('second')])
    await setSheets([])
    expect(document.activeElement).toBe(opener)
  })

  it('honors explicit input autofocus and still restores its original trigger', async () => {
    const opener = trigger()
    await setSheets([sheet('rename', { render: () => <><h3>Rename workout</h3><input autoFocus /></> })])
    expect(document.activeElement).toBe(container.querySelector('input'))
    await setSheets([])
    expect(document.activeElement).toBe(opener)
  })

  it('contains a centered confirmation and preserves existing background isolation', async () => {
    const opener = trigger()
    const privateNode = document.createElement('section')
    privateNode.setAttribute('inert', ''); privateNode.setAttribute('aria-hidden', 'true')
    container.appendChild(privateNode)
    await setSheets([{ ...dialogSheet('finish', 'Finish workout'), kind: 'center' }])
    const dialog = container.querySelector('.center[role="dialog"]')
    expect(document.activeElement).toBe(dialog)
    await keys('Escape')
    expect(document.activeElement).toBe(opener)
    expect(privateNode.hasAttribute('inert')).toBe(true)
    expect(privateNode.getAttribute('aria-hidden')).toBe('true')
  })

  it('returns to the original trigger after replacing a sheet with Finish summary', async () => {
    const opener = trigger()
    await setSheets([dialogSheet('review', 'Finish workout')])
    container.querySelector('[role="dialog"] button').focus()
    await setSheets([dialogSheet('summary', 'Workout saved', { locked: true })])
    await keys('Escape')
    expect(mocks.state.sheets.map(s => s.id)).toEqual(['summary'])
    await setSheets([])
    expect(document.activeElement).toBe(opener)
  })

  it('keeps an empty dialog reachable and redirects escaped focus back inside', async () => {
    const opener = trigger()
    await setSheets([sheet('empty', { locked: true, render: () => <h3>Loading replacements</h3> })])
    const dialog = container.querySelector('[role="dialog"]')
    expect((await keys('Tab')).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)
    opener.focus()
    expect(document.activeElement).toBe(dialog)
  })

  it('dismisses a reduced-motion drag immediately without an animated settlement', async () => {
    dom.matchMedia = () => ({ matches: true })
    await setSheets([dialogSheet('drag')])
    const el = container.querySelector('.sheet')
    await act(async () => {
      mouse(el, 'mousedown', 10)
      mouse(el, 'mousemove', 150)
      mouse(el, 'mouseup', 150)
    })
    expect(mocks.state.sheets).toHaveLength(0)
    expect(el.style.transition).toBe('none')
    expect(el.style.transform).not.toBe('translateY(110%)')
  })
})
