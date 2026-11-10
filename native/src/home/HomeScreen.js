import { useMemo, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { screenTopInset } from '../shell/tabs'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import NativeSymbol from '../ui/NativeSymbol'
import PrimaryButton from '../ui/PrimaryButton'
import ScreenHeader from '../ui/ScreenHeader'
import TextButton from '../ui/TextButton'
import { usePushLock } from '../ui/use-push-lock'
import DaySheet from '../nutrition/DaySheet'
import { canAct, todayView } from '../nutrition/nutrition-screen'
import { todayIso, useNutrition } from '../nutrition/use-nutrition'
import { HOME_EMPTY, homeView, nutritionNoticeLink } from './home-view'

// Home: the session the Workout tab would start, and today's nutrition. Next only switches to the
// Workout tab, which shows its start screen (or the session in progress). Log opens the Nutrition
// screen's day sheet for today and saves through the same hook, so the base is the copy the card
// was drawn from; it cannot open while a save runs (canAct). A nutrition edit the web overtook is
// explained only on the Nutrition screen, so the card points there while one is not dismissed.
export default function HomeScreen() {
  const router = useRouter()
  const guard = usePushLock()
  const n = useNutrition()
  const ready = n.status === 'ready'
  const today = todayIso()

  const view = useMemo(() => {
    if (!ready) return null
    const now = Date.now()
    return { ...homeView(n.state, { today, now }), today: todayView(n.state, { today }), notice: nutritionNoticeLink(n.notices) }
  }, [ready, n.state, n.notices, today])

  const opens = useRef(0)
  const [day, setDay] = useState(null)
  const idle = canAct({ ready, busy: false })
  const openDay = () => {
    if (!idle) return
    setDay({ no: ++opens.current, iso: todayIso(), open: true })
  }

  const source = { state: n.state, copy: n.copy }
  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingTop: screenTopInset(Platform.OS) }]}
      >
        <ScreenHeader title="Home" />
        {!view ? (
          <AppText variant="body" color={color.textSecondary} style={styles.pad}>
            {n.status === 'error' ? n.error?.message || 'Could not load Home.' : 'Loading…'}
          </AppText>
        ) : (
          <>
            <Card style={styles.card}>
              {view.next ? (
                <PrimaryButton
                  label={`Next: ${view.next.name}`}
                  accessibilityHint="Opens the Workout tab."
                  onPress={() => guard(() => router.navigate('/'))}
                />
              ) : (
                <AppText variant="body" color={color.textSecondary}>{HOME_EMPTY.next}</AppText>
              )}
            </Card>

            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={styles.grow}>
                  <AppText variant="label" color={color.textMuted}>{view.today.label}</AppText>
                  {view.today.logged
                    ? <AppText variant="lead">{view.today.headline}</AppText>
                    : <AppText variant="body" color={color.textSecondary}>{view.today.empty}</AppText>}
                  {view.today.target ? <AppText variant="label" color={color.textSecondary}>{view.today.target}</AppText> : null}
                </View>
                <TextButton
                  label={view.today.action}
                  accessibilityLabel={`${view.today.action} today's nutrition`}
                  accessibilityHint="Opens the day sheet for today."
                  disabled={!idle}
                  onPress={openDay}
                />
              </View>
              {view.today.lines.map(line => <AppText key={line} variant="body">{line}</AppText>)}
              {view.notice ? (
                <Pressable
                  key={view.notice.key}
                  accessibilityRole="button"
                  accessibilityLabel={view.notice.text}
                  accessibilityHint={view.notice.hint}
                  onPress={() => guard(() => router.push(view.notice.href))}
                  style={({ pressed }) => [styles.row, styles.link, pressed && styles.pressed]}
                >
                  <AppText variant="body" style={styles.grow}>{view.notice.text}</AppText>
                  <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
                </Pressable>
              ) : null}
            </Card>
          </>
        )}
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
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl, gap: space.md },
  pad: { marginHorizontal: space.lg },
  card: { marginHorizontal: space.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1 },
  link: { minHeight: touch.row, borderRadius: radius.sm },
  pressed: { backgroundColor: color.surfaceActive }
})
