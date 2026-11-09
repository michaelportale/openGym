import { describe, expect, test } from 'vitest'
import { OVERNIGHT_NOTICE, failureText } from './failure-text.js'

// Every code the session screen can receive: each `failure('…')` and `code: '…'` in
// session/session.js and session/session-controller.js, and the hook's own 'storage' for a write
// that threw.
const CODES = [
  'storage', 'unknown-set', 'known-set', 'last-set', 'unknown-exercise', 'known-exercise', 'last-exercise',
  'bad-index', 'bad-deadline', 'no-rest', 'bad-extend', 'bad-note', 'note-too-long', 'discarded', 'finished',
  'not-overnight', 'overnight', 'bad-end', 'end-before-start', 'not-ready', 'sender', 'payload', 'send',
  'not-saved', 'failed',
]
// What the screen was doing when the write was refused; undefined is a caller that did not say.
const ACTIONS = ['complete', 'rest', 'draft', 'edit', 'undo', 'add-set', 'add-warmup', 'add-time', 'skip-rest', 'resume', 'discard', 'finish', undefined]
const GENERIC = 'Something went wrong. Try again.'

describe('failureText', () => {
  test('every code, after every action, is a plain sentence that never contains the code', () => {
    for (const code of CODES) {
      for (const action of ACTIONS) {
        const text = failureText(code, { action })
        expect(text, `${code} / ${action}`).toMatch(/^[A-Z][^]*\.$/)
        expect(text.toLowerCase(), `${code} / ${action}`).not.toContain(code)
      }
    }
  })

  test('every code but the controller fallback has its own reason, not the generic one', () => {
    for (const code of CODES.filter(c => c !== 'failed')) {
      expect(failureText(code, { action: 'complete' }), code).not.toContain(GENERIC)
    }
    expect(failureText('failed', { action: 'complete' })).toBe(`Set not saved. ${GENERIC}`)
  })

  test('an unknown code, a missing one, or a name Object.prototype carries reads as the generic sentence', () => {
    expect(failureText('disk-on-fire', { action: 'complete' })).toBe(`Set not saved. ${GENERIC}`)
    expect(failureText('disk-on-fire')).toBe(`Not saved. ${GENERIC}`)
    expect(failureText(undefined)).toBe(`Not saved. ${GENERIC}`)
    expect(failureText(null, {})).toBe(`Not saved. ${GENERIC}`)
    expect(failureText('constructor', { action: 'toString' })).toBe(`Not saved. ${GENERIC}`)
    expect(failureText('__proto__', { action: '__proto__' })).toBe(`Not saved. ${GENERIC}`)
  })

  test('it says what was not done, then why', () => {
    expect(failureText('storage', { action: 'complete' })).toBe("Set not saved. The phone couldn't write it. Try again.")
    expect(failureText('storage', { action: 'draft' })).toBe("Numbers not saved. The phone couldn't write it. Try again.")
    expect(failureText('storage', { action: 'rest' })).toBe("Rest didn't start. The phone couldn't write it. Try again.")
    expect(failureText('unknown-set', { action: 'edit' })).toBe('Change not saved. That set is no longer in this workout.')
    expect(failureText('unknown-set', { action: 'undo' })).toBe('Set not undone. That set is no longer in this workout.')
    expect(failureText('unknown-exercise', { action: 'add-set' })).toBe('Set not added. That exercise is no longer in this workout.')
    expect(failureText('known-set', { action: 'add-warmup' })).toBe('Warm-up not added. That set is already in this workout.')
    expect(failureText('no-rest', { action: 'add-time' })).toBe('Time not added. No rest is running.')
    expect(failureText('bad-extend', { action: 'add-time' })).toBe("Time not added. The rest can't get any longer.")
    expect(failureText('no-rest', { action: 'skip-rest' })).toBe('Rest not skipped. No rest is running.')
    expect(failureText('not-overnight', { action: 'resume' })).toBe('Workout not resumed. This workout is already running.')
    expect(failureText('finished', { action: 'discard' })).toBe('Workout not deleted. This workout has already ended.')
    expect(failureText('discarded', { action: 'complete' })).toBe('Set not saved. This workout was deleted.')
    expect(failureText('send', { action: 'finish' })).toBe("Workout not saved. It didn't reach your history. Try again.")
    expect(failureText('not-saved', { action: 'finish' })).toBe("Workout not saved. The save wasn't confirmed. Try again.")
  })

  test('an overnight refusal keeps the stage-1 sentence, whatever was tapped', () => {
    expect(OVERNIGHT_NOTICE).toBe('Choose Resume, Finish or Discard first.')
    for (const action of ACTIONS) expect(failureText('overnight', { action })).toBe(OVERNIGHT_NOTICE)
  })
})
