import { AccessibilityInfo } from 'react-native'

// VoiceOver speaks neither live regions nor the alert role on iOS, so a result or a refusal on the
// Plan screens is said outright. Queued, as the session screen does (use-session-actions.js), so a
// sheet sliding away or VoiceOver moving focus does not cut it off.
export function announce(text) {
  if (text) AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true })
}
