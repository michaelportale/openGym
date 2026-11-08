import { motion } from './tokens.js'

export function motionDuration(name, reduced) {
  if (!Object.hasOwn(motion, name)) throw new Error(`Unknown motion name: ${name}`)
  return reduced ? 0 : motion[name]
}
