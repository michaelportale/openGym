import { useMemo, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import IconButton from '../ui/IconButton'
import LineChart from '../ui/LineChart'
import NativeSymbol from '../ui/NativeSymbol'
import SecondaryButton from '../ui/SecondaryButton'
import TextButton from '../ui/TextButton'
import { announce } from '../plan/announce'
import { RANGES } from '../progress/chart-label'
import { localDate } from '../session/timing'
import MeasurementSheet from './MeasurementSheet'
import { fieldChoices, fieldView } from './measurement-view'
import { historyList, latestView, measurementChartLabel, pickField } from './measurement-screen'
import { useMeasurements } from './use-measurements'

const FAILED = "Couldn't save. Try again."
const todayIso = () => localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)

// Which field the card shows (the web's SelectRow sheet): every offered field, the shown one ticked.
function FieldSheet({ visible, choices, selected, onPick, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.inset}>Choose measurement</AppText>
        <ScrollView style={styles.body} contentContainerStyle={styles.sheetContent} alwaysBounceVertical={false}>
          {choices.map(f => (
            <Pressable
              key={f.key}
              accessibilityRole="button"
              accessibilityLabel={f.label}
              accessibilityState={{ selected: f.key === selected }}
              onPress={() => onPick(f.key)}
              style={[styles.choice, f.key === selected && styles.choiceOn]}
            >
              <AppText variant="body" style={styles.grow}>{f.label}</AppText>
              {f.key === selected ? <NativeSymbol name="checkmark.circle.fill" tintColor={color.accent} size={size.icon} /> : null}
            </Pressable>
          ))}
          <SecondaryButton label="Close" accessibilityHint="Closes this list." onPress={onClose} />
        </ScrollView>
      </View>
    </Modal>
  )
}

// Body measurements (Measurements.jsx), reached from Progress: the chosen field's latest value and
// change in inches, its chart over 1M / 3M / 1Y / All, and the history with Edit and Delete. Which
// fields are enabled, and custom fields, are chosen on the web.
export default function MeasurementsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const m = useMeasurements()
  const ready = m.status === 'ready'
  const [range, setRange] = useState(90)
  const [selected, setSelected] = useState(null)
  const [picking, setPicking] = useState(false)
  // Read when a tap lands, not when the handler was made.
  const live = useRef(null)
  live.current = { state: m.state, copy: m.copy }

  const view = useMemo(() => {
    if (!ready) return null
    const now = Date.now()
    const choices = fieldChoices(m.state)
    const key = pickField(choices, selected)
    const field = key ? fieldView(m.state, key, { range, now }) : null
    return {
      choices,
      key,
      field,
      head: latestView(field),
      chartLabel: field ? measurementChartLabel(field, range, { now }) : null,
      history: historyList(m.state, { now }),
    }
  }, [ready, m.state, selected, range])

  // A failed delete, shown until the next action, and said to VoiceOver.
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  // The day as the copy holds it when Delete is tapped; the confirm only says yes to that.
  const remove = row => {
    if (busy || !ready) return
    const { copy } = live.current
    Alert.alert('Delete measurements?', `Deletes the measurements logged on ${row.label}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          setMessage(null)
          const result = await m.save({ edit: { op: 'remove', d: row.d }, copy })
          setBusy(false)
          if (result.ok) announce('Measurements deleted')
          else {
            setMessage(FAILED)
            announce(FAILED)
          }
        },
      },
    ])
  }

  // The log sheet stays mounted while closed, so it slides away; each open remounts it (key).
  const opens = useRef(0)
  const [sheet, setSheet] = useState(null)
  const openLog = (d, edit) => {
    if (!ready) return
    setMessage(null)
    setSheet({ no: ++opens.current, d, edit, open: true })
  }

  const body = () => {
    if (!view) {
      return (
        <AppText variant="body" color={color.textSecondary} style={styles.pad}>
          {m.status === 'error' ? m.error?.message || 'Could not load your measurements.' : 'Loading…'}
        </AppText>
      )
    }
    const { head, field, history } = view
    return (
      <>
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.pad}>{message}</AppText>
        ) : null}
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <AppText variant="label" color={color.textMuted}>{head.label}</AppText>
              <AppText variant="lead">{head.value}</AppText>
              {head.change ? <AppText variant="label" color={color.textSecondary}>{head.change}</AppText> : null}
            </View>
            <TextButton label="Log" accessibilityLabel="Log measurements" accessibilityHint="Opens the log sheet for today." onPress={() => openLog(todayIso(), false)} />
          </View>
          {view.choices.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Measurement, ${field.label}`}
              accessibilityHint="Opens the list of measurements to show."
              onPress={() => setPicking(true)}
              style={({ pressed }) => [styles.select, pressed && styles.pressed]}
            >
              <AppText variant="body" style={styles.grow}>Measurement</AppText>
              <AppText variant="body" color={color.textSecondary}>{field.label}</AppText>
              <NativeSymbol name="chevron.right" tintColor={color.textSecondary} size={size.icon} />
            </Pressable>
          ) : null}
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
          {field?.series.length ? (
            <LineChart points={field.series} label={view.chartLabel} />
          ) : (
            <AppText variant="body" color={color.textSecondary}>No data yet</AppText>
          )}
        </Card>

        {!view.choices.length ? (
          <Card style={styles.card}>
            <AppText variant="body" color={color.textSecondary}>Choose the measurements you want to track on the web, then log your first check-in here.</AppText>
          </Card>
        ) : null}

        <AppText variant="heading" accessibilityRole="header" style={styles.pad}>Measurement history</AppText>
        {history.length ? history.map(r => (
          <Card key={r.d} style={styles.card}>
            <View style={styles.row}>
              <View style={styles.grow}>
                <AppText variant="heading">{r.label}</AppText>
                <AppText variant="label" color={color.textMuted}>{r.countLine}</AppText>
              </View>
              <TextButton label="Edit" accessibilityLabel={r.editLabel} accessibilityHint="Opens this day's measurements." disabled={busy} onPress={() => openLog(r.d, true)} />
              <TextButton label="Delete" accessibilityLabel={r.deleteLabel} accessibilityHint="Asks before deleting this day's measurements." disabled={busy} onPress={() => remove(r)} />
            </View>
            {r.previewLine ? <AppText variant="body" color={color.textSecondary}>{r.previewLine}</AppText> : null}
          </Card>
        )) : (
          <View style={[styles.pad, styles.empty]}>
            <AppText variant="body" color={color.textSecondary}>No measurements yet</AppText>
            <SecondaryButton label="Add a measurement" accessibilityHint="Opens the log sheet for today." onPress={() => openLog(todayIso(), false)} />
          </View>
        )}
      </>
    )
  }

  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.top}>
          <IconButton label="Back" accessibilityLabel="Back" onPress={() => router.back()} />
        </View>
        <View style={styles.pad}>
          <AppText variant="title" accessibilityRole="header">Body measurements</AppText>
          <AppText variant="body" color={color.textSecondary}>Circumference & composition</AppText>
        </View>
        {body()}
      </ScrollView>
      {view ? (
        <FieldSheet
          visible={picking}
          choices={view.choices}
          selected={view.key}
          onPick={key => {
            setSelected(key)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
      {sheet ? (
        <MeasurementSheet
          key={sheet.no}
          visible={sheet.open}
          source={{ state: m.state, copy: m.copy }}
          initialDate={sheet.d}
          edit={sheet.edit}
          onSave={entry => m.save({ edit: { op: 'set', entry }, copy: m.copy })}
          onClose={() => setSheet(s => (s ? { ...s, open: false } : s))}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl * 2, gap: space.md },
  top: { paddingHorizontal: space.lg, alignItems: 'flex-start' },
  pad: { marginHorizontal: space.lg },
  card: { marginHorizontal: space.lg, padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1 },
  select: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.sm },
  pressed: { backgroundColor: color.surfaceActive },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: { minHeight: touch.min, minWidth: touch.min, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.sm, backgroundColor: color.control },
  chipOn: { backgroundColor: color.accent },
  empty: { gap: space.md },
  sheet: { flex: 1, gap: space.md, paddingTop: space.lg, backgroundColor: color.bg },
  inset: { paddingHorizontal: space.lg },
  body: { flex: 1 },
  sheetContent: { gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.xl },
  choice: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.stroke,
    backgroundColor: color.surface
  },
  choiceOn: { borderColor: color.accent, backgroundColor: color.surfaceActive }
})
