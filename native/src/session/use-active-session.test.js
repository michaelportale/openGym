import { expect, test } from 'vitest'
import { useActiveSession } from './use-active-session.js'

test('useActiveSession is a react hook over the session controller', () => {
  expect(typeof useActiveSession).toBe('function')
})
