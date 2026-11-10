import { useMemo, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import IconButton from '../ui/IconButton'
import NativeSymbol from '../ui/NativeSymbol'
import ScaleButton from '../ui/ScaleButton'
import SecondaryButton from '../ui/SecondaryButton'
import TextButton from '../ui/TextButton'
import { Notices } from '../plan/PlanScreen'
import { announce } from '../plan/announce'
import DaySheet from './DaySheet'
import TargetsSheet from './TargetsSheet'
import { clearDayValue, toggleSupplement } from './nutrition-view'
import { canAct, dayRows, nutritionNotices, supplementChecks, todayView, weekCard } from './nutrition-screen'
import { todayIso, useNutrition } from './use-nutrition'

const FAILED = "Couldn't save. Try again."

function WeekStep({ label, glyph, disabled, onPress }) {
  return (
    <ScaleButton accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.stepHit} faceStyle={[styles.stepFace, disabled && styles.disabled]}>
      <AppText variant="value" color={disabled ? color.textMuted : color.text}>{glyph}</AppText>
    </ScaleButton>
  )
}

// Nutrition (Nutrition.jsx), reached from Progress: notices of edits the web overtook, the Today
// card, the week, today's supplement check-offs and the last 14 days. Every save is built on the
// screen's { state, copy } as it was when the owner acted (a sheet's when it opened), so its base
// is the copy they saw (nutrition-screen.js nutritionSaveArgs).
export default function NutritionScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const n = useNutrition()
  const ready = n.status === 'ready'
  const today = todayIso()
  const [anchor, setAnchor] = useState(null) // a day of the week shown; null is this week
  // Read when a tap lands, not when the handler was made.
  const live = useRef(null)
  live.current = { state: n.state, copy: n.copy }

  const view = useMemo(() => {
    if (!ready) return null
    const now = Date.now()
    return {
      today: todayView(n.state, { today }),
      checks: supplementChecks(n.state, { today }),
      week: weekCard(n.state, { today, anchor, bodyweight: n.bodyweight }),
      days: dayRows(n.state, { now }),
      notices: nutritionNotices(n.notices, { now }),
    }
  }, [ready, n.state, n.bodyweight, n.notices, today, anchor])

  // A refusal or a failed save, shown until the next action, and said to VoiceOver.
  const [message, setMessage] = useState(null)
  const say = text => {
    setMessage(text)
    announce(text)
  }
  const [busy, setBusy] = useState(false)
  const idle = canAct({ ready, busy })

  // A day value saved from this screen (a tick, a clear), on the source it was made on.
  const saveDay = async (iso, value, copy, done) => {
    setBusy(true)
    setMessage(null)
    const result = await n.save({ kind: 'nutritionDay', key: iso, value, copy })
    setBusy(false)
    if (!result.ok) say(FAILED)
    else if (done) announce(done)
  }

  // Today is read when the box is ticked, so a tap just after midnight lands on the new day.
  const tick = id => {
    if (!idle) return
    const { state, copy } = live.current
    const iso = todayIso()
    let value
    try {
      value = toggleSupplement(state, iso, id)
    } catch {
      return
    }
    saveDay(iso, value, copy)
  }

  // The day as it is when Clear is tapped; the confirm only says yes to that.
  const clear = row => {
    if (!idle) return
    const { state, copy } = live.current
    Alert.alert('Clear this day?', `Removes the totals and note logged on ${row.label}. Supplement ticks stay.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => saveDay(row.iso, clearDayValue(state, row.iso), copy, 'Day cleared') },
    ])
  }

  // The sheets stay mounted while closed, so they slide away; each open remounts one (key).
  const opens = useRef(0)
  const [day, setDay] = useState(null)
  const [targets, setTargets] = useState(null)
  const openDay = iso => {
    if (!idle) return
    setMessage(null)
    setDay({ no: ++opens.current, iso, open: true })
  }
  const openTargets = () => {
    if (!ready) return
    setMessage(null)
    setTargets({ no: ++opens.current, open: true })
  }

  const body = () => {
    if (!view) {
      return (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          {n.status === 'error' ? n.error?.message || 'Could not load your nutrition.' : 'Loading…'}
        </AppText>
      )
    }
    const { today: t, week, checks, days } = view
    return (
      <>
        <Notices
          lines={view.notices.map(l => ({ ...l, rid: l.id }))}
          onDismiss={id => {
            const l = view.notices.find(x => x.id === id)
            if (l) n.dismiss(l.kind, l.key)
          }}
        />
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.pad}>{message}</AppText>
        ) : null}

        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <AppText variant="label" color={color.textMuted}>{t.label}</AppText>
              {t.logged ? <AppText variant="lead">{t.headline}</AppText> : <AppText variant="body" color={color.textSecondary}>{t.empty}</AppText>}
              {t.target ? <AppText variant="label" color={color.textSecondary}>{t.target}</AppText> : null}
            </View>
            <TextButton label={t.action} accessibilityLabel={`${t.action} today`} accessibilityHint="Opens the day sheet for today." disabled={!idle} onPress={() => openDay(todayIso())} />
          </View>
          {t.lines.map(line => <AppText key={line} variant="body">{line}</AppText>)}
        </Card>

        <Card style={styles.card}>
          <View style={styles.row}>
            <WeekStep label="Previous week" glyph="‹" onPress={() => setAnchor(week.prev)} />
            <AppText variant="heading" accessibilityRole="header" style={[styles.grow, styles.centered]}>{week.title}</AppText>
            <WeekStep label="Next week" glyph="›" disabled={week.current} onPress={() => setAnchor(week.next)} />
          </View>
          {week.empty ? (
            <>
              <AppText variant="body" color={color.textSecondary}>{week.emptyText}</AppText>
              {week.current ? <SecondaryButton label="Log today" accessibilityHint="Opens the day sheet for today." disabled={!idle} onPress={() => openDay(todayIso())} /> : null}
            </>
          ) : (
            <View style={styles.tiles}>
              {week.tiles.map(tile => (
                <View key={tile.key} accessible accessibilityLabel={tile.a11y} style={styles.tile}>
                  <AppText variant="label" color={color.textMuted}>{tile.label}</AppText>
                  <AppText variant="value">{tile.value}</AppText>
                  {tile.sub ? <AppText variant="label" color={color.textSecondary}>{tile.sub}</AppText> : null}
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.card}>
          <AppText variant="heading" accessibilityRole="header">Supplements</AppText>
          {checks.length ? checks.map(c => (
            <Pressable
              key={c.id}
              accessibilityRole="checkbox"
              accessibilityLabel={c.name}
              accessibilityHint="Ticks it off for today."
              accessibilityState={{ checked: c.checked, disabled: !idle }}
              disabled={!idle}
              onPress={() => tick(c.id)}
              style={({ pressed }) => [styles.check, pressed && styles.pressed]}
            >
              {c.checked
                ? <NativeSymbol name="checkmark.circle.fill" tintColor={color.accent} size={size.icon} />
                : <NativeSymbol name="square" tintColor={color.textSecondary} size={size.icon} />}
              <AppText variant="body" style={styles.grow}>{c.name}</AppText>
            </Pressable>
          )) : (
            <>
              <AppText variant="body" color={color.textSecondary}>Add the supplements you take, then tick them off each day.</AppText>
              <SecondaryButton label="Add supplements" accessibilityHint="Opens targets and supplements." onPress={openTargets} />
            </>
          )}
        </Card>

        <AppText variant="heading" accessibilityRole="header" style={styles.pad}>Recent days</AppText>
        {days.length ? days.map(r => (
          <Card key={r.iso} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <AppText variant="heading">{r.label}</AppText>
                <AppText variant="label" color={color.textMuted}>{r.subtitle}</AppText>
              </View>
              <TextButton label="Edit" accessibilityLabel={r.editLabel} accessibilityHint="Opens the day sheet for this day." disabled={!idle} onPress={() => openDay(r.iso)} />
              {r.canClear ? <TextButton label="Clear" accessibilityLabel={r.clearLabel} accessibilityHint="Asks before removing this day's totals and note." disabled={!idle} onPress={() => clear(r)} /> : null}
            </View>
            {r.lines.length ? <AppText variant="body" color={color.textSecondary}>{r.lines.join(' · ')}</AppText> : null}
            {r.note ? <AppText variant="body">{r.note}</AppText> : null}
          </Card>
        )) : (
          <View style={[styles.pad, styles.empty]}>
            <AppText variant="body" color={color.textSecondary}>Days you log show here, newest first.</AppText>
            <SecondaryButton label="Log your first day" accessibilityHint="Opens the day sheet for today." disabled={!idle} onPress={() => openDay(todayIso())} />
          </View>
        )}
      </>
    )
  }

  const source = { state: n.state, copy: n.copy }
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.top}>
          <IconButton label="Back" accessibilityLabel="Back" onPress={() => router.back()} />
          {ready ? <TextButton label="Targets" accessibilityLabel="Targets and supplements" accessibilityHint="Opens your targets and supplement list." onPress={openTargets} /> : null}
        </View>
        <View style={styles.pad}>
          <AppText variant="title" accessibilityRole="header">Nutrition</AppText>
          <AppText variant="body" color={color.textSecondary}>Daily totals, targets and supplements</AppText>
        </View>
        {body()}
      </ScrollView>
      {day ? (
        <DaySheet
          key={day.no}
          visible={day.open}
          source={source}
          initialDate={day.iso}
          onSave={({ iso, value, copy }) => n.save({ kind: 'nutritionDay', key: iso, value, copy })}
          onClose={() => setDay(d => (d ? { ...d, open: false } : d))}
        />
      ) : null}
      {targets ? (
        <TargetsSheet
          key={targets.no}
          visible={targets.open}
          source={source}
          onSave={n.save}
          onClose={() => setTargets(s => (s ? { ...s, open: false } : s))}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl * 2, gap: space.md },
  top: { paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pad: { marginHorizontal: space.lg },
  card: { marginHorizontal: space.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1 },
  centered: { textAlign: 'center' },
  stepHit: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  stepFace: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: color.control },
  disabled: { opacity: 0.5 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexGrow: 1, flexBasis: '45%', padding: space.md, gap: 2, borderRadius: radius.md, backgroundColor: color.control },
  check: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.sm },
  pressed: { backgroundColor: color.surfaceActive },
  empty: { gap: space.md }
})
