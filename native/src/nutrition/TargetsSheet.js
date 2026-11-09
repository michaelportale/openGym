import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import NumberRow from '../ui/NumberRow'
import PrimaryButton from '../ui/PrimaryButton'
import ScaleButton from '../ui/ScaleButton'
import TextButton from '../ui/TextButton'
import { announce } from '../plan/announce'
import { nutrition } from '../shared/training'
import { NAME, addSupplement, removeSupplement } from './nutrition-view'
import { supplementsSection, targetsDraft, targetsSave } from './nutrition-screen'
import { newSupplementId } from './use-nutrition'

const { DAY_TYPES, TARGET_KEYS, SUPPLEMENT_NAME_MAX } = nutrition
const FAILED = "Couldn't save. Try again."
const TYPE = { training: { title: 'Training day targets', name: 'Training day' }, rest: { title: 'Rest day targets', name: 'Rest day' } }
const unitOf = k => (k === 'kcal' ? 'kcal' : 'g')
const SPOKEN_UNIT = { kcal: 'kilocalories', g: 'grams' }

// Targets and supplements (Nutrition.jsx TargetsAndSupplements). Mounted per open (the caller keys
// it). `source` is the screen's { state, copy } as it is now. A supplement added or removed is saved
// at once, as on the web, built on the list as it is now. The targets are a draft taken when the
// sheet opens and saved with Done (the web saves each keystroke; the phone writes once), on the copy
// they were read from. While the draft differs from what is stored the sheet will not swipe away.
// onSave({ kind: 'setting', key, value, copy }) resolves { ok }: a refusal or a failed save shows
// here, is said to VoiceOver and keeps the sheet open with what was typed.
export default function TargetsSheet({ visible, source, onSave, onClose }) {
  const live = useRef(source)
  live.current = source
  const [opened] = useState(() => ({ src: source, draft: targetsDraft(source.state) }))
  const [draft, setDraft] = useState(opened.draft)
  const [name, setName] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const dirty = targetsSave(opened.src.state, draft) !== null
  const section = supplementsSection(source.state)

  const say = text => {
    setMessage(text)
    announce(text)
  }
  const type = (t, k, text) => setDraft(d => ({ ...d, [t]: { ...d[t], [k]: text } }))

  // One setting write at a time: each is built on the list or targets the screen holds when it runs.
  const write = async (key, value, copy) => {
    setBusy(true)
    setMessage(null)
    const result = await onSave({ kind: 'setting', key, value, copy })
    setBusy(false)
    if (!result?.ok) say(FAILED)
    return !!result?.ok
  }

  const add = async () => {
    if (busy) return
    const { state, copy } = live.current
    const list = addSupplement(state, name, newSupplementId())
    if (!Array.isArray(list)) {
      if (list.error) say(list.error)
      return
    }
    if (await write('supplements', list, copy)) setName('')
  }

  const remove = async id => {
    if (busy) return
    const { state, copy } = live.current
    await write('supplements', removeSupplement(state, id), copy)
  }

  const done = async () => {
    if (busy) return
    const value = targetsSave(opened.src.state, draft)
    if (value === null || await write('nutritionTargets', value, opened.src.copy)) onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy && !dirty} onRequestClose={done}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.inset}>Targets and supplements</AppText>
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.inset}>{message}</AppText>
        ) : null}
        <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" alwaysBounceVertical={false}>
          {DAY_TYPES.map(t => (
            <View key={t} style={styles.group}>
              <AppText variant="label" color={color.textSecondary} accessibilityRole="header">{TYPE[t].title}</AppText>
              {TARGET_KEYS.map(k => (
                <NumberRow
                  key={k}
                  label={NAME[k]}
                  unit={unitOf(k)}
                  accessibilityLabel={`${TYPE[t].name} ${NAME[k].toLowerCase()} target in ${SPOKEN_UNIT[unitOf(k)]}`}
                  value={draft[t][k]}
                  onChangeText={text => type(t, k, text)}
                  decimal={k !== 'kcal'}
                  editable={!busy}
                />
              ))}
              {t === 'rest' ? <AppText variant="label" color={color.textMuted}>Leave a field empty for no target.</AppText> : null}
            </View>
          ))}

          <View style={styles.group}>
            <AppText variant="label" color={color.textSecondary} accessibilityRole="header">Supplements</AppText>
            {section.rows.map(x => (
              <View key={x.id} style={styles.row}>
                <AppText variant="body" style={styles.grow}>{x.name}</AppText>
                <TextButton label="Remove" accessibilityLabel={x.removeLabel} accessibilityHint="Removes it from the list. Days it was ticked keep it." disabled={busy} onPress={() => remove(x.id)} />
              </View>
            ))}
            <AppText variant="label" color={color.textMuted}>{section.footer}</AppText>
            <View style={styles.row}>
              <TextInput
                accessibilityLabel="Supplement name"
                style={[styles.input, styles.grow]}
                value={name}
                onChangeText={setName}
                placeholder="Supplement name"
                placeholderTextColor={color.textMuted}
                maxLength={SUPPLEMENT_NAME_MAX}
                returnKeyType="done"
                onSubmitEditing={add}
                editable={!busy}
                maxFontSizeMultiplier={2.2}
              />
              <ScaleButton
                accessibilityLabel="Add"
                accessibilityHint="Adds this supplement to the list."
                accessibilityState={{ disabled: busy || !name.trim() }}
                disabled={busy || !name.trim()}
                onPress={add}
                style={styles.addHit}
                faceStyle={[styles.addFace, (busy || !name.trim()) && styles.disabled]}
              >
                <AppText variant="button">Add</AppText>
              </ScaleButton>
            </View>
          </View>

          <PrimaryButton label={busy ? 'Saving…' : 'Done'} accessibilityLabel={busy ? 'Saving' : 'Done'} accessibilityHint={dirty ? 'Saves your targets and closes.' : 'Closes this sheet.'} disabled={busy} onPress={done} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.md, paddingTop: space.lg, backgroundColor: color.bg },
  inset: { paddingHorizontal: space.lg },
  body: { flex: 1 },
  content: { gap: space.xl, paddingHorizontal: space.lg, paddingBottom: space.xl },
  group: { gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1 },
  row: { minHeight: touch.row, flexDirection: 'row', alignItems: 'center', gap: space.md },
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
  addHit: { minHeight: touch.row, justifyContent: 'center' },
  addFace: { minHeight: touch.row, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: color.control },
  disabled: { opacity: 0.5 }
})
