import { Capacitor } from '@capacitor/core'

export const stored = key => localStorage.getItem(key)
export const native = () => Capacitor.isNativePlatform()
