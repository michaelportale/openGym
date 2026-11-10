import { StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import LineChart from '../ui/LineChart'
import PrimaryButton from '../ui/PrimaryButton'
import TextButton from '../ui/TextButton'
import { useWhoop } from './use-whoop'
import { WHOOP_TEXT, whoopCardView } from './whoop-view'

// WHOOP on Progress, read-only, below the Nutrition and Measurements rows: today's recovery, HRV,
// resting HR and strain, the 7-day recovery chart, recent cardio, Disconnect when connected and
// "As of" when the numbers are not fresh. Not connected, it has Connect; unpaired, only its line.
export default function WhoopCard() {
  const { shown, busy, message, connect, disconnect } = useWhoop()
  // Worked out on every render (it is small), so "Today" and "As of" follow the clock past
  // midnight: Progress renders again on focus then, as its source key holds the date.
  const v = shown ? whoopCardView(shown.payload, { paired: shown.paired, cached: shown.cached, savedAt: shown.savedAt ?? null, now: Date.now() }) : null

  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">WHOOP</AppText>
      {message ? (
        <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</AppText>
      ) : null}
      {!v ? (
        <AppText variant="body" color={color.textSecondary}>Loading…</AppText>
      ) : (
        <>
          {v.line ? <AppText variant="body" color={color.textSecondary}>{v.line}</AppText> : null}
          {v.state === 'disconnected' ? (
            <PrimaryButton label={WHOOP_TEXT.connect} accessibilityHint="Opens Safari to sign in to WHOOP." disabled={busy} onPress={connect} />
          ) : null}
          {v.today ? (
            <View style={styles.group}>
              <AppText variant="label" color={color.textMuted}>{v.today.title}</AppText>
              {v.today.rows.map(r => (
                <View key={r.key} accessible accessibilityLabel={r.a11y} style={styles.row}>
                  <AppText variant="body" style={styles.grow}>{r.label}</AppText>
                  <AppText variant="value">{r.value}</AppText>
                </View>
              ))}
            </View>
          ) : null}
          {v.series.length ? (
            <View style={styles.group}>
              <AppText variant="label" color={color.textMuted} accessibilityElementsHidden importantForAccessibility="no">Recovery, last 7 days</AppText>
              <LineChart points={v.series} label={v.chartLabel} height={120} />
            </View>
          ) : null}
          {v.cardio.length ? (
            <View style={styles.group}>
              <AppText variant="label" color={color.textMuted}>Recent cardio</AppText>
              {v.cardio.map(c => (
                <View key={c.key} accessible accessibilityLabel={c.a11y} style={styles.workout}>
                  <View style={styles.row}>
                    <AppText variant="body" style={styles.grow}>{c.sport}</AppText>
                    <AppText variant="label" color={color.textMuted}>{c.date}</AppText>
                  </View>
                  <AppText variant="body" color={color.textSecondary}>{c.line}</AppText>
                </View>
              ))}
            </View>
          ) : null}
          {v.connected ? (
            <View style={styles.action}>
              <TextButton label="Disconnect" accessibilityLabel="Disconnect WHOOP" accessibilityHint="Asks before your server stops reading WHOOP." disabled={busy} onPress={disconnect} />
            </View>
          ) : null}
          {v.asOf ? <AppText variant="label" color={color.textMuted}>{v.asOf}</AppText> : null}
        </>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, gap: space.md },
  group: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flexShrink: 1, flexGrow: 1 },
  workout: { gap: space.xs },
  // The word lines up with the card's text; its 44-pt touch target reaches into the padding.
  action: { alignSelf: 'flex-start', marginLeft: -space.sm }
})
