import { expect, test } from 'vitest'
import { deliverPick, endPick, waitForPick } from './pick-relay.js'

test('a pick reaches the screen that waits for it, and its answer comes back', () => {
  const picked = []
  const token = waitForPick(id => { picked.push(id); return 'saved' })
  expect(deliverPick(token, 'bench')).toBe('saved')
  expect(picked).toEqual(['bench'])
})

test('a stale or ended token reaches nothing', () => {
  const picked = []
  const old = waitForPick(id => picked.push(['old', id]))
  const token = waitForPick(id => picked.push(['new', id]))
  expect(deliverPick(old, 'bench')).toBeNull()
  endPick(old) // ending an old token leaves the newer wait alone
  deliverPick(token, 'row')
  endPick(token)
  expect(deliverPick(token, 'ohp')).toBeNull()
  expect(picked).toEqual([['new', 'row']])
})
