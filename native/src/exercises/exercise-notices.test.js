import { describe, expect, test } from 'vitest'
import { PLAN_NOTICE_KINDS } from '../plan/plan-view.js'
import { canAuthorCustom, exerciseNoticeLines } from './exercise-notices.js'

const curl = { id: 'c1', n: 'Curl', bp: 'arms' }

const notice = (key, reason = 'changed', extra = {}) => ({ kind: 'customEx', key, name: 'from the store', reason, at: '1', ...extra })
const row = (key, value, baseTs = 5) => ({ kind: 'customEx', key, baseTs, value })

describe('exerciseNoticeLines', () => {
  test('an edit names the stored value, then the exercise still in state, then this exercise', () => {
    const state = { customEx: [curl, { id: 'c2', n: 'Row' }] }
    const lines = exerciseNoticeLines(
      [notice('c1', 'changed'), notice('c2', 'deleted'), notice('c3', 'unsafe'), notice('c9', 'changed')],
      [
        row('c1', { id: 'c1', n: 'Hammer curl' }),
        row('c2', { id: 'c2', n: '' }),
        row('c3', { id: 'c3', n: '   ' }),
        row('c9', { deleted: true }),
      ],
      state,
    )
    expect(lines.map(line => line.text)).toEqual([
      "Your change to Hammer curl wasn't sent: it was changed on the web first.",
      "Your change to Row wasn't sent: it was deleted on the web.",
      "Your change to this exercise wasn't sent: it couldn't be sent safely.",
      "This exercise changed on the web, so it wasn't deleted.",
    ])
    expect(lines[2].dismissLabel).toBe('Dismiss notice about this exercise')
    expect(lines.every(line => line.dismissLabel.startsWith('Dismiss notice about '))).toBe(true)
  })

  test('a create on base 0 uses the edit sentences, and a sentence-start name is capitalised only for the fallback', () => {
    const state = { customEx: [{ id: 'c2', n: 'curl' }] }
    const lines = exerciseNoticeLines(
      [notice('c1', 'changed'), notice('c1', 'deleted'), notice('c1', 'unsafe'), notice('c2', 'deleted'), notice('c3', 'unsafe')],
      [
        row('c1', { id: 'c1', n: 'curl' }, 0),
        row('c2', { id: 'c2' }, 0),
        row('c3', { deleted: true }, 0),
      ],
      state,
    )
    expect(lines.map(line => [line.key, line.text, line.dismissLabel])).toEqual([
      ['c1', "Your change to curl wasn't sent: it was changed on the web first.", 'Dismiss notice about curl'],
      ['c1', "curl wasn't added: an exercise with that id was deleted on your server.", 'Dismiss notice about curl'],
      ['c1', "curl wasn't added: it couldn't be sent safely. Try adding it again.", 'Dismiss notice about curl'],
      ['c2', "curl wasn't added: an exercise with that id was deleted on your server.", 'Dismiss notice about curl'],
      ['c3', "This exercise wasn't added: it couldn't be sent safely. Try adding it again.", 'Dismiss notice about this exercise'],
    ])
  })

  test('a delete is the marker, and an unknown reason reads as changed', () => {
    const state = { customEx: [{ id: 'c1', n: 'Curl' }] }
    const lines = exerciseNoticeLines(
      [notice('c1', 'changed'), notice('c1', 'nope'), notice('c2', 'unsafe')],
      [
        row('c1', { deleted: true }, 4),
        row('c2', { deleted: true, n: 'Kept' }, 4),
      ],
      state,
    )
    expect(lines.map(line => line.text)).toEqual([
      "Curl changed on the web, so it wasn't deleted.",
      "Curl changed on the web, so it wasn't deleted.",
      "Your change to Kept wasn't sent: it couldn't be sent safely.",
    ])
    expect(lines[0].text).not.toContain('move or swap')
  })

  test('a notice with no row is an edit, other kinds are not shown, and a missing list is none', () => {
    const lines = exerciseNoticeLines(
      [notice('c1'), { kind: 'routine', key: 'a', reason: 'changed' }, null],
      [null, { kind: 'routine', key: 'c1', baseTs: 0, value: { n: 'Wrong' } }],
      { customEx: [curl] },
    )
    expect(lines).toEqual([{
      key: 'c1',
      text: "Your change to Curl wasn't sent: it was changed on the web first.",
      dismissLabel: 'Dismiss notice about Curl',
    }])
    expect(exerciseNoticeLines(null, null, null)).toEqual([])
    expect(exerciseNoticeLines(undefined, [], undefined)).toEqual([])
  })

  test('customEx is not a Plan notice kind', () => {
    expect(PLAN_NOTICE_KINDS).not.toContain('customEx')
    expect(PLAN_NOTICE_KINDS).toEqual(['routine', 'routineOrder', 'schedule'])
  })
})

describe('canAuthorCustom', () => {
  test('only while a server copy is held', () => {
    expect(canAuthorCustom({ rev: 3, state: {} })).toBe(true)
    expect(canAuthorCustom(null)).toBe(false)
    expect(canAuthorCustom(undefined)).toBe(false)
  })
})
