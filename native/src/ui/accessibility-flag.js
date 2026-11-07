const FLAGS = {
  reduceMotion: { read: 'isReduceMotionEnabled', event: 'reduceMotionChanged' },
  reduceTransparency: { read: 'isReduceTransparencyEnabled', event: 'reduceTransparencyChanged' }
}

export function accessibilityFlag(name) {
  if (!Object.hasOwn(FLAGS, name)) throw new Error(`Unknown accessibility flag: ${name}`)
  return FLAGS[name]
}

// True while a platform can answer. The hook starts reduced in that case.
// A missing reader is not a request for the reduced treatment.
export function accessibilityFlagDefault(info, name) {
  const { read } = accessibilityFlag(name)
  return typeof info?.[read] === 'function'
}
