import { useMemo } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { screenTopInset } from '../shell/tabs'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import NativeSymbol from '../ui/NativeSymbol'
import ScaleButton from '../ui/ScaleButton'
import ScreenHeader from '../ui/ScreenHeader'
import { usePushLock } from '../ui/use-push-lock'
import { nextRoutineId } from '../workout/next-up'
import { planView } from './plan-view'
import { usePlan } from './use-plan'

const exercises = n => (n === 1 ? '1 exercise' : `${n} exercises`)

// The edits that were not sent, each with Dismiss (labelled with the routine). `lines` from noticeLines.
export function Notices({ lines, onDismiss }) {
  return lines.map(n => (
    <Card key={n.rid} style={styles.notice}>
      <AppText variant="body">{n.text}</AppText>
      <ScaleButton
        accessibilityLabel={n.dismissLabel}
        accessibilityHint="Hides this notice."
        onPress={() => onDismiss(n.rid)}
        style={styles.dismiss}
        faceStyle={styles.dismissFace}
      >
        <AppText variant="label" color={color.accent}>Dismiss</AppText>
      </ScaleButton>
    </Card>
  ))
}

function Schedule({ schedule }) {
  if (!schedule) return null
  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">How you train</AppText>
      <AppText variant="label" color={color.textMuted}>{schedule.kind === 'rotation' ? 'Rotation' : 'Fixed week'}</AppText>
      {schedule.kind === 'rotation'
        ? schedule.items.map((item, i) => (
          <View key={item.id} accessible accessibilityLabel={`${i + 1}. ${item.name}${item.next ? ', next' : ''}`} style={styles.line}>
            <AppText variant="value" color={color.textMuted} style={styles.order}>{i + 1}</AppText>
            <AppText variant="body" style={styles.grow}>{item.name}</AppText>
            {item.next ? <AppText variant="label" color={color.accent} style={styles.tag}>Next</AppText> : null}
          </View>
        ))
        : schedule.days.map(day => (
          <AppText key={day.label} variant="body" color={day.names ? color.text : color.textSecondary}>
            {`${day.label} · ${day.names ? day.names.join(' + ') : 'Rest'}`}
          </AppText>
        ))}
    </Card>
  )
}

// The Plan tab: notices of edits that were not sent, how you train, then every routine. A routine
// opens its own screen.
export default function PlanScreen() {
  const router = useRouter()
  const guard = usePushLock()
  const plan = usePlan()
  const ready = plan.status === 'ready'
  // The replay behind next-up runs once per state, not per render.
  const nextId = useMemo(() => (ready ? nextRoutineId(plan.state, Date.now()) : null), [ready, plan.state])
  const view = useMemo(() => (ready ? planView(plan.state, { nextId, notices: plan.notices }) : null), [ready, plan.state, plan.notices, nextId])

  return (
    <ScrollView
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingTop: screenTopInset(Platform.OS) }]}
    >
      <ScreenHeader title="Plan" />
      {!view ? (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          {plan.status === 'error' ? plan.error?.message || 'Could not load your plan.' : 'Loading…'}
        </AppText>
      ) : (
        <>
          <Notices lines={view.notices} onDismiss={plan.dismiss} />
          <Schedule schedule={view.schedule} />
          <Card style={[styles.card, styles.routines]}>
            <AppText variant="heading" accessibilityRole="header" style={styles.routinesHead}>Your routines</AppText>
            {view.routines.length ? view.routines.map((r, i) => (
              <Pressable
                key={`${r.id}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`${r.name}, ${exercises(r.count)}`}
                accessibilityHint="Opens this routine."
                onPress={() => guard(() => router.push('/routine/' + encodeURIComponent(r.id)))}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.grow}>
                  <AppText variant="heading">{r.name}</AppText>
                  <AppText variant="label" color={color.textMuted}>{exercises(r.count)}</AppText>
                </View>
                <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
              </Pressable>
            )) : (
              <AppText variant="body" color={color.textSecondary} style={styles.empty}>No routines in your plan yet.</AppText>
            )}
          </Card>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl },
  pad: { marginHorizontal: space.lg },
  card: { marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, gap: space.sm },
  notice: { marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, gap: space.sm },
  dismiss: { minHeight: touch.min, alignSelf: 'flex-start', justifyContent: 'center' },
  dismissFace: { paddingHorizontal: space.sm, marginLeft: -space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  order: { minWidth: 20 },
  grow: { flexShrink: 1, flexGrow: 1 },
  tag: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: color.accent },
  // The rows' own touch height spaces them, as Your lifts does.
  routines: { gap: 0, paddingHorizontal: 0, paddingBottom: space.xs },
  routinesHead: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  row: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.stroke
  },
  pressed: { backgroundColor: color.surfaceActive },
  empty: { paddingHorizontal: space.lg, paddingVertical: space.md }
})
