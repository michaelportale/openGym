import * as Haptics from 'expo-haptics'

// The thin adapter over expo-haptics: notification feedback only. iOS applies the system haptics
// setting itself. A failure is logged and never reaches the write or the screen's notice.
const TYPES = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
}

export function playHaptic(kind) {
  const type = TYPES[kind]
  if (type === undefined) return
  try {
    Haptics.notificationAsync(type).catch(error => console.warn('Haptic failed:', error?.message ?? error))
  } catch (error) {
    console.warn('Haptic failed:', error?.message ?? error)
  }
}
