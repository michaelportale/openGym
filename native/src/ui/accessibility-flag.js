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

// The value each flag last resolved to in this run of the app (a read or a change event). A hook
// mounted later starts from it, so only a mount before any read has resolved takes the default
// above. A failed read is not a value and is not remembered.
export function flagMemory() {
  const known = new Map()
  return {
    start: (info, name) => (known.has(name) ? known.get(name) : accessibilityFlagDefault(info, name)),
    remember: (name, value) => {
      accessibilityFlag(name)
      known.set(name, Boolean(value))
    }
  }
}
