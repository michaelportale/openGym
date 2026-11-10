import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import DayStepper from '../ui/DayStepper'
import NativeSymbol from '../ui/NativeSymbol'
import NumberRow from '../ui/NumberRow'
import PrimaryButton from '../ui/PrimaryButton'
import SecondaryButton from '../ui/SecondaryButton'
import { sheetDate, stepDay, todayIso } from '../ui/dates'
import { SAVE_FAILED } from '../ui/messages'
import { SPOKEN_UNIT } from '../ui/number-text'
import { announce } from '../plan/announce'
import { nutrition } from '../shared/training'
import { DAY_TYPE_NAME, NAME, applyDayForm, unitOf } from './nutrition-view'
import { dayDraft, dayValues } from './nutrition-screen'

const { NUTRIENTS, DAY_TYPES, NOTE_MAX } = nutrition

// Log or edit one day's totals (Nutrition.jsx DayLog). Mounted per open (the caller keys it).
// `source` is the screen's { state, copy } as it is now; the draft and the copy it was made on are
// taken from `opened` (default: `source`) when the sheet opens, and from `source` again when the
// date moves, as the web re-reads the day (pickDate). Save builds the day on that same pair, so its
// base is the copy the owner saw. Home passes `opened`: the pair a fresh load gave just before.
// onSave({ iso, value, copy }) resolves { ok }: a refusal or a failed save shows here, is said to
// VoiceOver and keeps the sheet open with what was typed.
export default function DaySheet({ visible, source, opened, initialDate, onSave, onClose }) {
  const live = useRef(source)
  live.current = source
  const [made, setMade] = useState(() => {
    const src = opened ?? source
    return { src, draft: dayDraft(src.state, initialDate) }
  })
  const { src, draft } = made
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const today = todayIso()

  const say = text => {
    setMessage(text)
    announce(text)
  }
  const edit = patch => setMade(m => ({ ...m, draft: { ...m.draft, ...patch } }))
  const type = (k, text) => setMade(m => ({ ...m, draft: { ...m.draft, text: { ...m.draft.text, [k]: text } } }))
  const pickDate = dir => {
    const next = stepDay(draft.iso, dir, todayIso())
    if (!next || busy) return
    setMessage(null)
    setMade({ src: live.current, draft: dayDraft(live.current.state, next) })
  }
  const close = () => {
    if (!busy) onClose()
  }

  const save = async () => {
    if (busy) return
    const out = applyDayForm(src.state, draft.iso, dayValues(draft), { today: todayIso() })
    if (out.error) {
      say(out.error)
      return
    }
    setBusy(true)
    setMessage(null)
    const result = await onSave({ iso: draft.iso, value: out.value, copy: src.copy })
    setBusy(false)
    if (result?.ok) {
      announce('Day saved')
      onClose()
    } else say(SAVE_FAILED)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={close}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.inset}>{draft.title}</AppText>
        {/* Outside the scroll, so a refusal stays on screen while the buttons are scrolled to. */}
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.inset}>{message}</AppText>
        ) : null}
        <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" alwaysBounceVertical={false}>
          <AppText variant="body" color={color.textSecondary}>The day's totals. All five are needed for the day to count.</AppText>
          <DayStepper text={sheetDate(draft.iso, today)} canForward={draft.iso < today} disabled={busy} onStep={pickDate} />

          <View style={styles.types}>
            {DAY_TYPES.map(t => (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityLabel={DAY_TYPE_NAME[t]}
                accessibilityState={{ selected: draft.dayType === t, disabled: busy }}
                disabled={busy}
                onPress={() => edit({ dayType: t })}
                style={[styles.type, draft.dayType === t && styles.typeOn]}
              >
                <AppText variant="body" style={styles.grow}>{DAY_TYPE_NAME[t]}</AppText>
                {draft.dayType === t ? <NativeSymbol name="checkmark.circle.fill" tintColor={color.accent} size={size.icon} /> : null}
              </Pressable>
            ))}
          </View>

          <View style={styles.group}>
            {NUTRIENTS.map(k => (
              <NumberRow
                key={k}
                label={NAME[k]}
                unit={unitOf(k)}
                accessibilityLabel={`${NAME[k]} in ${SPOKEN_UNIT[unitOf(k)]}`}
                value={draft.text[k]}
                onChangeText={text => type(k, text)}
                decimal={k !== 'kcal'}
                editable={!busy}
              />
            ))}
          </View>

          <View style={styles.field}>
            <AppText variant="label" color={color.textSecondary}>Note · Optional</AppText>
            <TextInput
              accessibilityLabel="Note, optional"
              style={[styles.input, styles.note]}
              value={draft.note}
              onChangeText={note => edit({ note })}
              maxLength={NOTE_MAX}
              multiline
              editable={!busy}
              maxFontSizeMultiplier={2.2}
            />
          </View>

          <PrimaryButton label={busy ? 'Saving…' : 'Save'} accessibilityLabel={busy ? 'Saving' : 'Save'} accessibilityHint="Saves this day's totals." disabled={busy} onPress={save} />
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
  types: { flexDirection: 'row', gap: space.sm },
  type: {
    flex: 1,
    minHeight: touch.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.stroke,
    backgroundColor: color.surface
  },
  typeOn: { borderColor: color.accent, backgroundColor: color.surfaceActive },
  field: { gap: space.xs },
  input: {
    minHeight: touch.row,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.stroke,
    backgroundColor: color.field,
    color: color.text,
    fontSize: 17
  },
  note: { minHeight: 88, paddingTop: space.sm, textAlignVertical: 'top' }
})
