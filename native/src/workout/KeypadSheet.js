import { useEffect, useRef, useState } from 'react'
import { AppState, Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import PrimaryButton from '../ui/PrimaryButton'
import ScaleButton from '../ui/ScaleButton'
import WhySheet from './WhySheet'
import { whyEntry } from './why-entry'
import { RIR_CHOICES, isRirSelected, rirChipHint, rirChipLabel, rirChipText, toggleRir } from './effort-choice'
import { actionsStacked, applyKey, completeBlocker, fieldLocked, fieldText, keypadState, keypadValues, sheetCloseAction, sideLockHint, sideLockNote } from './keypad'
import { spokenField } from './spoken'

const STEP_WHY = whyEntry('increments')
const EFFORT_WHY = whyEntry('effort')
const CHIPS = ['-10', '-5', '+5', '+10']
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']

// A neutral key: ink on grey, never the accent.
function Key({ text, label, hint, style = styles.key, disabled = false, onPress }) {
  return (
    <ScaleButton accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={style} faceStyle={[styles.keyFace, disabled && styles.off]}>
      <AppText variant="value">{text}</AppText>
    </ScaleButton>
  )
}

// `id` is the keypad field ('w', 'r', 'L.r', 'R.r'); `title` is what it shows ('Lb each').
// `setWith` ('L' or 'R') marks a field that logged side holds (fieldLocked: the shared weight, or
// that side's reps): it shows and takes no input. The note sits under the field row (sideLockNote);
// VoiceOver hears it here, the side in the weight's label and the way to change it as the hint.
function Field({ id, title, text, active, perHand, setWith = null, onPress }) {
  const lockHint = sideLockHint(setWith)
  return (
    <ScaleButton
      accessibilityLabel={spokenField(id, text, { perHand, setWith })}
      accessibilityHint={lockHint ?? 'Selects this field for the keypad.'}
      accessibilityState={{ selected: active, disabled: lockHint !== null }}
      disabled={lockHint !== null}
      onPress={onPress}
      style={styles.fieldSlot}
      faceStyle={[styles.field, active && styles.fieldActive]}
    >
      <AppText variant="label" color={color.textSecondary}>{title}</AppText>
      <AppText variant="lead">{text}</AppText>
    </ScaleButton>
  )
}

const keyLabel = key => (key === 'back' ? 'Delete' : key === '.' ? 'Decimal point' : key)
const keyHint = key => (key === 'back' ? 'Deletes the last character.' : 'Types into the selected field.')

// `initial` is { w, r } or, per side, { w, sides: { L: { r }, R: { r } } }. Save and Complete
// hand over keypadValues (numbers or null). Closing by swipe, back or Close calls
// onClose(values, changed) where `changed` is sheetCloseAction(...) === 'save'; the caller decides
// whether to store a draft. `initialField` is 'w', 'r', or per side 'L.r'/'R.r' (a tapped reps box
// opens on reps). `weightTitle` is 'Lb each' for a per-hand exercise, which also passes `perHand`
// so the weight field is spoken "pounds each". A done set passes saveLabel 'Update', onUndo, and
// no onComplete. `completeLabel` and `completeSpoken` are completeLabels(...) (keypad.js): what the
// Complete button shows and what VoiceOver says. A warm-up not done yet passes onRemove, its Remove
// warm-up. `notice` shows a write that was refused.
// Under the title, Close and any notice, the sheet scrolls, so at the largest text sizes every
// control can be reached; from the accessibility sizes on, Save and Complete stack full width
// (actionsStacked).
// `side` is the side Complete logs on a per-side set; Complete waits for its reps and the weight.
// `weightSetWith` ('L' or 'R') is the side a half-done per-side set was logged with: the weight
// field, the weight chips and that side's reps take no input, and the sheet opens on the other
// side's reps.
// While open, every app state change calls onAppState(next, values, changed), so the caller can
// keep typed numbers when the app leaves the front (a kill from the app switcher follows).
export default function KeypadSheet({ visible, title, initial, perSide, side = null, initialField = 'w', weightSetWith = null, weightTitle = 'Lb', perHand = false, saveLabel = 'Save', completeLabel = 'Complete', completeSpoken, effort = null, notice, onSave, onComplete, onUndo, onRemove, onClose, onAppState }) {
  const [state, setState] = useState(() => keypadState(initial, initialField, { weightSetWith }))
  const [why, setWhy] = useState(false)
  const [whyEffort, setWhyEffort] = useState(false)
  // Reps left lives here until Complete or Update: not part of the typed-numbers draft. `touched`
  // tells a tap from the value the row already holds, so an untouched row writes nothing.
  const [reps, setReps] = useState({ rir: effort?.rir ?? null, touched: false })
  useEffect(() => {
    // The keypad can close under an open Why sheet (the app returns after a long absence);
    // never present it again on the next open.
    setWhy(false)
    setWhyEffort(false)
    if (visible) {
      setState(keypadState(initial, initialField, { weightSetWith }))
      setReps({ rir: effort?.rir ?? null, touched: false })
    }
  }, [visible])
  const stacked = actionsStacked(useWindowDimensions().fontScale)
  const lockNote = sideLockNote(state.lock)
  const values = keypadValues(state)
  const blocked = completeBlocker(values, side)
  const press = key => () => setState(current => applyKey(current, key))
  const fields = perSide ? [['L.r', 'Left reps'], ['R.r', 'Right reps']] : [['r', 'Reps']]
  const rirOut = reps.touched ? reps.rir : undefined
  const changed = () => sheetCloseAction(keypadState(initial), state) === 'save'
  const close = () => onClose(values, changed())
  // The listener outlives this render; it reads the numbers on screen when the app state changes.
  const live = useRef(null)
  live.current = { values, changed, onAppState }
  useEffect(() => {
    if (!visible) return
    const sub = AppState.addEventListener('change', next => {
      const now = live.current
      now.onAppState?.(next, now.values, now.changed())
    })
    return () => sub.remove()
  }, [visible])
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.title}>{title}</AppText>
          <IconButton label="Close" accessibilityLabel="Close" accessibilityHint="Closes the keypad." onPress={close} />
        </View>
        {/* Outside the scroll, so a refusal stays on screen while the buttons are scrolled to. */}
        {notice ? (
          <AppText variant="body" color={color.text} accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.notice}>{notice}</AppText>
        ) : null}
        <ScrollView style={styles.body} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
          <View style={styles.fields}>
            <Field id="w" title={weightTitle} text={fieldText(state, 'w')} active={state.field === 'w'} perHand={perHand} setWith={fieldLocked(state, 'w') ? state.lock : null} onPress={press('field:w')} />
            {fields.map(([id, name]) => (
              <Field key={id} id={id} title={name} text={fieldText(state, id)} active={state.field === id} setWith={fieldLocked(state, id) ? state.lock : null} onPress={press(`field:${id}`)} />
            ))}
          </View>
          {/* Under the row, so the weight field stays the height of its neighbours. VoiceOver
              hears it with the weight field (Field), so not here a second time. */}
          {lockNote ? (
            <AppText variant="label" color={color.textSecondary} accessibilityElementsHidden importantForAccessibility="no">{lockNote}</AppText>
          ) : null}
          <View style={styles.chips}>
            {CHIPS.map(chip => (
              <Key key={chip} text={chip.replace('-', '−')} label={`${chip.startsWith('-') ? 'Minus' : 'Plus'} ${chip.slice(1)} pounds`} hint="Changes the weight." style={styles.chip} disabled={state.lock !== null} onPress={press(`chip:${chip}`)} />
            ))}
          </View>
          <ScaleButton accessibilityLabel="About load steps" accessibilityHint="Shows where this number comes from." onPress={() => setWhy(true)} style={styles.why} faceStyle={styles.whyFace}>
            <AppText variant="label" color={color.textSecondary}>About load steps</AppText>
          </ScaleButton>
          <View style={styles.grid}>
            {KEYS.map(key => (
              <Key key={key} text={key === 'back' ? '⌫' : key} label={keyLabel(key)} hint={keyHint(key)} onPress={press(key)} />
            ))}
          </View>
          {effort ? (
            <View style={styles.effort}>
              <View style={styles.effortHead}>
                <AppText variant="label" accessibilityRole="header" color={color.textSecondary}>Reps left</AppText>
                <ScaleButton accessibilityLabel="Why reps left?" accessibilityHint="Shows why reps left is asked." onPress={() => setWhyEffort(true)} style={styles.why} faceStyle={styles.whyFace}>
                  <AppText variant="label" color={color.textSecondary}>Why?</AppText>
                </ScaleButton>
              </View>
              <View style={styles.effortChips}>
                {RIR_CHOICES.map(n => {
                  const selected = isRirSelected(reps.rir, n)
                  return (
                    <ScaleButton
                      key={n}
                      accessibilityLabel={rirChipLabel(n)}
                      accessibilityHint={rirChipHint(reps.rir, n)}
                      accessibilityState={{ selected }}
                      onPress={() => setReps(current => ({ rir: toggleRir(current.rir, n), touched: true }))}
                      style={styles.effortChip}
                      faceStyle={[styles.keyFace, selected && styles.chipSelected]}
                    >
                      <AppText variant="value" color={selected ? color.onAccent : color.text}>{rirChipText(n)}</AppText>
                    </ScaleButton>
                  )
                })}
              </View>
            </View>
          ) : null}
          <View style={stacked ? styles.stacked : styles.actions}>
            <View style={stacked ? null : styles.action}>
              <ScaleButton
                accessibilityLabel={saveLabel}
                accessibilityHint={onComplete ? 'Keeps these numbers without completing the set.' : 'Changes this set to these numbers.'}
                onPress={() => onSave(values, rirOut)}
                faceStyle={styles.save}
              >
                <AppText variant="button">{saveLabel}</AppText>
              </ScaleButton>
            </View>
            {onComplete ? (
              <View style={stacked ? null : styles.action}>
                <PrimaryButton label={completeLabel} accessibilityLabel={completeSpoken} disabled={blocked !== null} accessibilityHint={blocked === 'weight' ? 'Enter a weight first.' : blocked === 'reps' ? 'Enter the reps first.' : 'Logs this set.'} onPress={() => onComplete(values, rirOut)} />
              </View>
            ) : null}
          </View>
          {onUndo ? (
            <ScaleButton accessibilityLabel="Undo set" accessibilityHint="Marks this set as not done." onPress={onUndo} faceStyle={styles.quiet}>
              <AppText variant="button" color={color.textSecondary}>Undo set</AppText>
            </ScaleButton>
          ) : null}
          {/* A non-breaking hyphen: a large label wraps at the space, never inside "warm-up". */}
          {onRemove ? (
            <ScaleButton accessibilityLabel="Remove warm-up" accessibilityHint="Takes this warm-up out of the workout." onPress={onRemove} faceStyle={styles.quiet}>
              <AppText variant="button" color={color.textSecondary}>{'Remove warm\u2011up'}</AppText>
            </ScaleButton>
          ) : null}
        </ScrollView>
      </View>
      {/* A second Modal inside this one's view: iOS presents it over the keypad, which keeps its
          typed numbers; closing returns here. Reading it never writes. */}
      <WhySheet visible={why} entry={STEP_WHY} onClose={() => setWhy(false)} />
      <WhySheet visible={whyEffort} entry={EFFORT_WHY} onClose={() => setWhyEffort(false)} />
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.lg, paddingTop: space.lg, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg },
  notice: { paddingHorizontal: space.lg },
  body: { flex: 1 },
  content: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.lg },
  title: { flexShrink: 1 },
  fields: { flexDirection: 'row', gap: space.sm },
  fieldSlot: { flex: 1 },
  field: { flexGrow: 1, minHeight: touch.primary, gap: space.xs, padding: space.md, backgroundColor: color.field, borderColor: color.stroke, borderWidth: size.stroke, borderRadius: radius.md },
  fieldActive: { borderColor: color.text },
  // The primary button's face (accent fill, dark label) with a heavier border: selected reads without colour alone.
  chipSelected: { backgroundColor: color.accent, borderColor: color.text, borderWidth: size.stroke * 2 },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: { flex: 1 },
  why: { alignSelf: 'flex-start', minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  whyFace: { minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  effort: { gap: space.sm },
  effortHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  effortChips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  effortChip: { flexGrow: 1, flexBasis: '14%', minWidth: touch.min },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  key: { flexBasis: '31%', flexGrow: 1 },
  keyFace: { minHeight: touch.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: color.control, borderColor: color.stroke, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  off: { opacity: 0.4 },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
  stacked: { gap: space.sm },
  save: { minHeight: touch.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: color.control, borderColor: color.stroke, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  quiet: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center' }
})
