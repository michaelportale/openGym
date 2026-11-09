import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import { healthLines } from './health-status'
import { useHealth } from './use-health'

// "Apple Health": switch workouts on or off, see what was sent, retry what is waiting.
export default function HealthSection() {
  const { status, enable, disable, retry } = useHealth()
  const [busy, setBusy] = useState(null) // the intended switch state while an enable/disable runs

  if (!status) return <View style={styles.section}><AppText variant="heading" accessibilityRole="header">Apple Health</AppText></View>

  const lines = healthLines(status)
  const settle = fn => {
    setBusy(fn.intended)
    fn.run().catch(() => {}).finally(() => setBusy(null))
  }

  const onToggle = next => {
    if (next) {
      settle({ intended: true, run: enable })
      return
    }
    Alert.alert(
      'Turn off Apple Health?',
      'Workouts already in Apple Health can stay there, or openGym can remove the ones it wrote.',
      [
        { text: "Keep what's there", onPress: () => settle({ intended: false, run: () => disable({ remove: false }) }) },
        { text: "Also remove openGym's workouts", style: 'destructive', onPress: () => settle({ intended: false, run: () => disable({ remove: true }) }) },
        { text: 'Cancel', style: 'cancel' },
      ],
    )
  }

  return (
    <View style={styles.section}>
      <AppText variant="heading" accessibilityRole="header">Apple Health</AppText>
      <Card style={styles.card}>
        <View style={styles.row}>
          <AppText variant="value">Apple Health</AppText>
          <Switch
            accessibilityLabel="Apple Health"
            value={busy ?? status.on}
            disabled={busy !== null}
            onValueChange={onToggle}
          />
        </View>
        {lines.map((line, i) => (
          <AppText key={i} variant="body" color={i === 0 ? undefined : color.textSecondary} accessibilityLiveRegion={i === 0 ? 'polite' : undefined}>{line}</AppText>
        ))}
      </Card>
      {status.on && status.waiting > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          accessibilityHint="Tries again to send the waiting workouts to Apple Health."
          onPress={() => { retry().catch(() => {}) }}
          style={styles.secondary}
        >
          <AppText variant="button" style={styles.centered}>Retry</AppText>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space.md, paddingHorizontal: space.lg },
  card: { padding: space.lg, gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secondary: {
    minHeight: touch.min,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.strokeStrong
  },
  centered: { textAlign: 'center' }
})
