import { double } from './clean-dep.js'

export const quad = n => double(double(n))
