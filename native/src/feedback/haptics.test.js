import { describe, expect, it } from 'vitest'
import { hapticFor, hapticForWrite, restEndedNow } from './haptics.js'

describe('hapticFor', () => {
  it('maps the three events', () => {
    expect(hapticFor('set-saved')).toBe('success')
    expect(hapticFor('rest-ended')).toBe('warning')
    expect(hapticFor('write-failed')).toBe('error')
  })
  it('is silent for anything else', () => {
    expect(hapticFor('keypad')).toBeNull()
    expect(hapticFor(undefined)).toBeNull()
  })
})

describe('hapticForWrite', () => {
  const saved = { ok: true, saved: true }
  it('buzzes success for a saved set, warm-up included', () => {
    expect(hapticForWrite('complete', saved)).toBe('success')
    expect(hapticForWrite('complete-warmup', saved)).toBe('success')
  })
  it('a saved set whose rest failed is still a saved set', () => {
    expect(hapticForWrite('complete', { ...saved, restFailed: true })).toBe('success')
  })
  it('a saved set with a warning is still saved', () => {
    expect(hapticForWrite('complete', { ...saved, draftError: { code: 'storage' } })).toBe('success')
  })
  it('is silent for other saved writes', () => {
    for (const action of ['draft', 'edit', 'undo', 'pause-rest', 'add-set', 'skip-rest', undefined]) {
      expect(hapticForWrite(action, saved)).toBeNull()
    }
  })
  it('is silent for a Complete that saved nothing without failing', () => {
    expect(hapticForWrite('complete', { ok: true, saved: false, duplicate: true })).toBeNull()
    expect(hapticForWrite('complete', null)).toBeNull()
  })
  it('buzzes error for any failed write', () => {
    const failed = { ok: false, saved: false, error: { code: 'storage' } }
    expect(hapticForWrite('complete', failed)).toBe('error')
    expect(hapticForWrite('draft', failed)).toBe('error')
    expect(hapticForWrite('pause-rest', failed)).toBe('error')
    expect(hapticForWrite('finish', { ok: false, saved: true, error: { code: 'x' } })).toBe('error')
  })
  it('is silent for a dropped tap', () => {
    expect(hapticForWrite('complete', { ignored: true })).toBeNull()
  })
  it('is silent for a write the owner did not tap, even a failed one', () => {
    const failed = { ok: false, saved: false, error: { code: 'storage' } }
    expect(hapticForWrite('draft', failed, { tapped: false })).toBeNull()
    expect(hapticForWrite('complete', saved, { tapped: false })).toBeNull()
    expect(hapticForWrite('draft', failed, { tapped: true })).toBe('error')
  })
})

describe('restEndedNow', () => {
  const running = { status: 'running', remainingMs: 800, deadline: 5000, totalMs: 60000 }
  const complete = { status: 'complete', remainingMs: 0, deadline: 5000, totalMs: 60000 }
  it('is true on a live crossing with the app active', () => {
    expect(restEndedNow(running, complete, true)).toBe(true)
  })
  it('is false with no previous tick (back from the background)', () => {
    expect(restEndedNow(null, complete, true)).toBe(false)
    expect(restEndedNow(undefined, complete, true)).toBe(false)
  })
  it('is false when the app is not active', () => {
    expect(restEndedNow(running, complete, false)).toBe(false)
  })
  it('is false for a paused rest', () => {
    const paused = { ...running, status: 'paused' }
    expect(restEndedNow(paused, complete, true)).toBe(false)
    expect(restEndedNow(running, paused, true)).toBe(false)
  })
  it('is false for a different deadline', () => {
    expect(restEndedNow(running, { ...complete, deadline: 9000 }, true)).toBe(false)
  })
  it('is false when the previous tick was already complete or had nothing left', () => {
    expect(restEndedNow(complete, complete, true)).toBe(false)
    expect(restEndedNow({ ...running, remainingMs: 0 }, complete, true)).toBe(false)
  })
  it('is false while still running or with no rest', () => {
    expect(restEndedNow(running, running, true)).toBe(false)
    expect(restEndedNow(running, null, true)).toBe(false)
  })
})
