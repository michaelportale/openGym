import { motionDuration } from '../theme/motion'
import { useAccessibilityFlag } from './use-accessibility-flag'

export function useMotion() {
  const reduced = useAccessibilityFlag('reduceMotion')
  return { duration: name => motionDuration(name, reduced) }
}
