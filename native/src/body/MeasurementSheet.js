import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import DayStepper from '../ui/DayStepper'
import NumberRow from '../ui/NumberRow'
import PrimaryButton from '../ui/PrimaryButton'
import SecondaryButton from '../ui/SecondaryButton'
import { sheetDate, stepDay, todayIso } from '../ui/dates'
import { SAVE_FAILED } from '../ui/messages'
import { SPOKEN_UNIT } from '../ui/number-text'
import { announce } from '../plan/announce'
import { logDraft, logSave } from './measurement-screen'

// Log or edit one day's measurements (Measurements.jsx MeasurementLog), in inches; body fat in
// percent. Mounted per open (the caller keys it). `edit` opens on day `initialDate` with its values
// and keeps that day; a new log starts empty and its day steps back from today. `source` is the
// screen's { state } as it is now: Save builds the day on it as it is then, writing only the
// fields typed to something other than they showed (measurement-screen.js logSave). onSave(entry)
// resolves { ok }: a refusal or a failed save shows here, is said to VoiceOver and keeps the sheet
// open with what was typed.
export default function MeasurementSheet({ visible, source, initialDate, edit, onSave, onClose }) {
  const live = useRef(source)
  live.current = source
  const [draft] = useState(() => logDraft(source.state, initialDate, { edit }))
  const [d, setD] = useState(initialDate)
  const [text, setText] = useState(draft.text)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  const say = msg => {
    setMessage(msg)
    announce(msg)
  }
  const pickDate = dir => {
    const next = stepDay(d, dir, todayIso())
    if (!next || busy) return
    setMessage(null)
    setD(next)
  }
  const close = () => {
    if (!busy) onClose()
  }

  const save = async () => {
    if (busy || !draft.fields.length) return
    const out = logSave(live.current.state, { draft, d, text }, { now: Date.now() })
    if (out.error) {
      say(out.error)
      return
    }
    setBusy(true)
    setMessage(null)
    const result = await onSave(out.entry)
    setBusy(false)
    if (result?.ok) {
      announce('Measurements saved')
      onClose()
    } else say(SAVE_FAILED)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={close}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.inset}>{draft.title}</AppText>
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.inset}>{message}</AppText>
        ) : null}
        <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" alwaysBounceVertical={false}>
          <AppText variant="body" color={color.textSecondary}>Fill only what you measured today. Empty fields stay empty.</AppText>
          {draft.editing ? (
            <View accessible accessibilityLabel={`Date, ${sheetDate(d, today)}`} style={styles.date}>
              <AppText variant="body" style={styles.grow}>Date</AppText>
              <AppText variant="value">{sheetDate(d, today)}</AppText>
            </View>
          ) : (
            <DayStepper text={sheetDate(d, today)} canForward={d < today} disabled={busy} onStep={pickDate} />
          )}
          {draft.fields.length ? (
            <View style={styles.group}>
              {draft.fields.map(f => (
                <NumberRow
                  key={f.key}
                  label={f.label}
                  unit={f.unit}
                  accessibilityLabel={`${f.label} in ${SPOKEN_UNIT[f.unit] ?? f.unit}`}
                  value={text[f.key]}
                  onChangeText={t => setText(cur => ({ ...cur, [f.key]: t }))}
                  editable={!busy}
                />
              ))}
            </View>
          ) : (
            <AppText variant="body" color={color.textSecondary}>Choose at least one measurement first.</AppText>
          )}
          <PrimaryButton
            label={busy ? 'Saving…' : 'Save'}
            accessibilityLabel={busy ? 'Saving' : 'Save'}
            accessibilityHint="Saves these measurements."
            disabled={busy || !draft.fields.length}
            onPress={save}
          />
          <SecondaryButton label="Cancel" accessibilityHint="Closes without saving." disabled={busy} onPress={close} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.md, paddingTop: space.lg, backgroundColor: color.bg },
  inset: { paddingHorizontal: space.lg },
  body: { flex: 1 },
  content: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.xl },
  group: { gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1 },
  date: {
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: color.surface
  }
})
