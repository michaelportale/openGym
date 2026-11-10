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
import { announce } from '../plan/announce'
import { todayIso } from '../ui/dates'
import { usePushLock } from '../ui/use-push-lock'
import DaySheet from '../nutrition/DaySheet'
import { useNutrition } from '../nutrition/use-nutrition'
import { HOME_EMPTY, daySheetOpen, homeView, nutritionNoticeLink } from './home-view'

// Home: the session the Workout tab would start, and today's nutrition. Next only switches to the
// Workout tab, which shows its start screen (or the session in progress). Log opens the Nutrition
// screen's day sheet for today and saves through the same hook. Home is a tab and stays mounted, so
// what it shows can predate a supplement tick saved on Nutrition: Log reads the stores again first
// and opens the sheet on that fresh read (home-view.js daySheetOpen), whose copy is the save's base;
// if the read fails, no sheet opens and Home says so. A nutrition edit the web overtook is explained
// only on the Nutrition screen, so the card points there while one is not dismissed.
export default function HomeScreen() {
  const router = useRouter()
  const guard = usePushLock()
  const n = useNutrition()
  const ready = n.status === 'ready'
  const today = todayIso()

  const view = useMemo(() => {
    if (!ready) return null
    const now = Date.now()
    return { ...homeView(n.state, { today, now }), notice: nutritionNoticeLink(n.notices) }
  }, [ready, n.state, n.notices, today])

  const opens = useRef(0)
  const [day, setDay] = useState(null)
  // A failed open, shown until the next one, and said to VoiceOver.
  const [message, setMessage] = useState(null)
  // One open at a time: the ref stops a second tap before the re-render dims the button.
  const openingRef = useRef(false)
  const [opening, setOpening] = useState(false)
  const openDay = async () => {
    if (!ready || openingRef.current) return
    openingRef.current = true
    setOpening(true)
    setMessage(null)
    const open = daySheetOpen(await n.reload())
    openingRef.current = false
    setOpening(false)
    if (open.error) {
      setMessage(open.error)
      announce(open.error)
      return
    }
    setDay({ no: ++opens.current, iso: todayIso(), open: true, source: open.source })
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
                  disabled={!ready || opening}
                  onPress={openDay}
                />
              </View>
              {view.today.lines.map(line => <AppText key={line} variant="body">{line}</AppText>)}
              {message ? (
                <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</AppText>
              ) : null}
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
          opened={day.source}
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
