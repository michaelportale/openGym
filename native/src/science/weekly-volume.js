import { whyThis } from './rules.js'

/**
 * No weekly set target. The primary dose-response paper has not been read.
 * A screen calls this and shows nothing. It must not invent a number.
 */
export function weeklyVolumeTarget() {
  return null
}

export function weeklyVolumeWhy() {
  return whyThis('weekly-volume')
}
