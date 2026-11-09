import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import LineChart from '../ui/LineChart'
import ScaleButton from '../ui/ScaleButton'
import { afterPaint } from '../ui/after-paint'
import { usePushLock } from '../ui/use-push-lock'
import WhySheet from '../workout/WhySheet'
import { whyEntry } from '../workout/why-entry'
import { bodyweightCard } from './bodyweight-card'
import { chartLabel, RANGES } from './chart-label'
import { liftRows, liftsCard, strengthRows } from './lifts-view'
import { useProgress } from './use-progress'

const BW_WHY = whyEntry('bodyweight-trend')
const E1RM_WHY = whyEntry('e1rm-formula')

function WhyLink({ label, hint, onPress }) {
  return (
    <ScaleButton accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={styles.why} faceStyle={styles.whyFace}>
      <AppText variant="label" color={color.accent}>Why this?</AppText>
    </ScaleButton>
  )
}

// The Progress tab's cards, between the header and the placeholder card. `children` is the Today
// line and Log weight button, which sit at the top of the Body weight card.
export default function ProgressBody({ children }) {
  const router = useRouter()
  const guard = usePushLock()
  const { status, state, bodyweight, error } = useProgress()
  const [range, setRange] = useState(90)
  const [why, setWhy] = useState(null)
  // Models run on their inputs only, not on every render. `now` is read when they recompute.
  const card = useMemo(() => bodyweightCard({ bodyweight, range, now: Date.now(), targetW: state?.targetW ?? null }), [bodyweight, range, state])
  const trend = useMemo(() => strengthRows(state, { now: Date.now() }), [state])
  // Your lifts is the heavy one (a history pass per exercise): worked out once per state, after the
  // cards above it have painted. Until the first rows are ready it says Loading…; after that the
  // last rows show while new ones are worked out.
  const [rows, setRows] = useState(null)
  useEffect(() => (state ? afterPaint(() => setRows(liftRows(state))) : undefined), [state])
  const lifts = liftsCard(state, rows)

  return (
    <>
      <Card style={styles.card}>
        <AppText variant="heading" accessibilityRole="header">Body weight</AppText>
        {children}
        {status !== 'ready' ? (
          <AppText variant="body" color={color.textSecondary}>
            {status === 'error' ? error?.message || 'Could not load your progress.' : 'Loading…'}
          </AppText>
        ) : (
          <>
            {card.averageLine ? (
              <View style={styles.row}>
                <AppText variant="value" style={styles.grow}>{card.averageLine}</AppText>
                <WhyLink label="Why this? 7-day average" hint="Shows how the 7-day average is worked out." onPress={() => setWhy('bw')} />
              </View>
            ) : null}
            {card.weekLine ? <AppText variant="body" color={color.textSecondary}>{card.weekLine}</AppText> : null}
            {card.monthLine ? <AppText variant="body" color={color.textSecondary}>{card.monthLine}</AppText> : null}
            {card.towardLine ? <AppText variant="body" color={color.textSecondary}>{card.towardLine}</AppText> : null}
            {card.nudge ? <AppText variant="body" color={color.textSecondary}>{card.nudge}</AppText> : null}
            <View style={styles.chips}>
              {RANGES.map(r => (
                <Pressable
                  key={r.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: range === r.days }}
                  accessibilityLabel={r.label}
                  onPress={() => setRange(r.days)}
                  style={[styles.chip, range === r.days && styles.chipOn]}
                >
                  <AppText variant="label" color={range === r.days ? color.onAccent : color.text}>{r.label}</AppText>
                </Pressable>
              ))}
            </View>
            {card.chart ? (
              <LineChart points={card.chart.points} trend={card.chart.trend} goal={card.chart.goal} dotsOnly={card.chart.dotsOnly} label={chartLabel(range, card.averageLine)} />
            ) : null}
            {card.recent.length ? (
              <View style={styles.recent}>
                <AppText variant="label" color={color.textMuted}>Recent weigh-ins</AppText>
                {card.recent.map(r => (
                  <View key={r.d} style={styles.row}>
                    <AppText variant="body" style={styles.grow}>{r.label}</AppText>
                    {r.health ? <AppText variant="label" color={color.textMuted}>Health</AppText> : null}
                    <AppText variant="value">{r.weight}</AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </Card>

      {status === 'ready' && trend.length ? (
        <Card style={styles.card}>
          <View style={styles.row}>
            <AppText variant="heading" accessibilityRole="header" style={styles.grow}>Strength trend</AppText>
            <WhyLink label="Why this? e1RM" hint="Shows how e1RM is worked out." onPress={() => setWhy('e1rm')} />
          </View>
          {trend.map(t => (
            <View key={t.id} style={styles.row}>
              <AppText variant="body" style={styles.grow}>{t.name}</AppText>
              <AppText variant="value">{t.line}</AppText>
            </View>
          ))}
        </Card>
      ) : null}

      {status === 'ready' && (lifts.loading || lifts.rows.length) ? (
        <Card style={[styles.card, styles.lifts]}>
          <AppText variant="heading" accessibilityRole="header">Your lifts</AppText>
          {lifts.loading ? <AppText variant="body" color={color.textSecondary} style={styles.wait}>Loading…</AppText> : null}
          {lifts.rows.map(l => (
            <Pressable
              key={l.id}
              accessibilityRole="button"
              accessibilityLabel={`${l.name}, ${l.label}`}
              onPress={() => guard(() => router.push('/exercise/' + encodeURIComponent(l.id)))}
              style={[styles.row, styles.lift]}
            >
              <AppText variant="body" style={styles.grow}>{l.name}</AppText>
              <AppText variant="value" color={color.textSecondary}>{l.label}</AppText>
            </Pressable>
          ))}
        </Card>
      ) : null}

      <WhySheet visible={why === 'bw'} entry={BW_WHY} onClose={() => setWhy(null)} />
      <WhySheet visible={why === 'e1rm'} entry={E1RM_WHY} onClose={() => setWhy(null)} />
    </>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grow: { flexShrink: 1, flexGrow: 1 },
  why: { minHeight: touch.min, justifyContent: 'center' },
  whyFace: { paddingHorizontal: space.sm },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: { minHeight: touch.min, minWidth: touch.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: color.control },
  chipOn: { backgroundColor: color.accent },
  recent: { gap: space.sm },
  // The rows' own 48-pt touch height spaces them: the card's gap and full bottom padding left a
  // band under the last row (and about 1,800 pt of extra scrolling at 150 lifts).
  lifts: { gap: 0, paddingBottom: space.xs },
  lift: { minHeight: touch.row },
  wait: { paddingVertical: space.md }
})
