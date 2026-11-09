import { useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import PrimaryButton from '../ui/PrimaryButton'
import PairSheet from './PairSheet'
import { defaultDay, defaultTime } from './sync-status'
import { serverLines } from './sync-triggers'
import { useSync } from './use-sync'

function SecondaryButton({ label, accessibilityHint, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondary, disabled && styles.disabled]}
    >
      <AppText variant="button" style={styles.centered}>{label}</AppText>
    </Pressable>
  )
}

function lastSyncedLine(status) {
  const at = Date.parse(status?.lastSyncedAt ?? '')
  if (!Number.isFinite(at)) return 'Not synced yet.'
  const day = defaultDay(at)
  const today = day === defaultDay(Date.now())
  return `Last synced ${today ? '' : `${day}, `}${defaultTime(at)}`
}

// "Your server": pair, see how syncing stands, sync now, forget. The token is never shown.
export default function ServerSection() {
  const { status, text, pair, forget, syncNow, resendAll } = useSync()
  const [pairing, setPairing] = useState(false)

  if (!status) return <View style={styles.section}><AppText variant="heading" accessibilityRole="header">Your server</AppText></View>

  const lines = serverLines(status)
  const syncing = status.state === 'syncing'

  const askForget = () => {
    Alert.alert(
      `Forget ${lines.host}?`,
      `This phone stops syncing with ${lines.host}. Your workouts stay on this phone, and pairing again sends anything the server is missing.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Forget this server', style: 'destructive', onPress: () => { forget().catch(() => {}) } },
      ],
    )
  }

  return (
    <View style={styles.section}>
      <AppText variant="heading" accessibilityRole="header">Your server</AppText>
      {status.paired ? (
        <>
          <Card style={styles.card}>
            <AppText variant="value">{lines.host}</AppText>
            {lines.profile ? <AppText variant="body" color={color.textSecondary}>{`Signed in as ${lines.profile}`}</AppText> : null}
            <AppText variant="body" accessibilityLiveRegion="polite">{text}</AppText>
            {lines.lastSynced ? <AppText variant="body" color={color.textSecondary}>{lastSyncedLine(status)}</AppText> : null}
            {lines.pending ? <AppText variant="body" color={color.textSecondary}>{lines.pending}</AppText> : null}
          </Card>
          <PrimaryButton
            label={syncing ? 'Syncing…' : 'Sync now'}
            accessibilityLabel={syncing ? 'Syncing' : 'Sync now'}
            accessibilityHint="Sends your workouts to the server and reads its changes."
            disabled={syncing}
            onPress={() => { syncNow().catch(() => {}) }}
          />
          {lines.canResend ? (
            <>
              <AppText variant="body" color={color.textSecondary}>The server has older data than this phone last saw. Sending puts every workout on this phone back on the server.</AppText>
              <SecondaryButton
                label="Send this phone's workouts again"
                accessibilityHint="Sends every workout on this phone to the server again."
                disabled={syncing}
                onPress={() => { resendAll().catch(() => {}) }}
              />
            </>
          ) : null}
          <SecondaryButton label="Forget this server" accessibilityHint="Asks before this phone stops syncing." onPress={askForget} />
        </>
      ) : (
        <>
          <AppText variant="body" color={color.textSecondary}>{text}</AppText>
          <PrimaryButton label="Pair with your server" accessibilityHint="Opens a form for the server address and pairing code." onPress={() => setPairing(true)} />
        </>
      )}
      <PairSheet visible={pairing} onPair={pair} onClose={() => setPairing(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space.md, paddingHorizontal: space.lg },
  card: { padding: space.lg, gap: space.xs },
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
  disabled: { opacity: 0.4 },
  centered: { textAlign: 'center' }
})
