import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import PrimaryButton from '../ui/PrimaryButton'
import { focusRingStyle } from '../ui/focus-ring'
import { usePressScale } from '../ui/use-press-scale'
import { applyKey, fieldText, keypadState, keypadValues, sheetCloseAction } from './keypad'

const CHIPS = ['-10', '-5', '+5', '+10']
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back']

// A neutral key: ink on grey, never the accent.
function Key({ text, label, hint, minHeight, onPress }) {
  const press = usePressScale()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={styles.key}
      {...press.handlers}
    >
      <Animated.View style={[styles.keyFace, { minHeight }, focusRingStyle(focused, Platform.OS, color.accent), press.style]}>
        <AppText variant="value">{text}</AppText>
      </Animated.View>
    </Pressable>
  )
}

function Field({ title, text, active, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${text === '–' ? 'not set' : text}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.field, active && styles.fieldActive]}
    >
      <AppText variant="label" color={color.textSecondary}>{title}</AppText>
      <AppText variant="lead">{text}</AppText>
    </Pressable>
  )
}

// `initial` is { w, r } or, per side, { w, sides: { L: { r }, R: { r } } }. Save and Complete
// hand over keypadValues (numbers or null). Closing by swipe, back or Close calls
// onClose(values, changed) where `changed` is sheetCloseAction(...) === 'save'; the caller decides
// whether to store a draft. `weightTitle` is 'Lb each' for a per-hand exercise.
export default function KeypadSheet({ visible, title, initial, perSide, weightTitle = 'Lb', onSave, onComplete, onClose }) {
  const [state, setState] = useState(() => keypadState(initial))
  useEffect(() => {
    if (visible) setState(keypadState(initial))
  }, [visible])
  const values = keypadValues(state)
  const press = key => () => setState(current => applyKey(current, key))
  const fields = perSide ? [['L.r', 'Left reps'], ['R.r', 'Right reps']] : [['r', 'Reps']]
  const close = () => onClose(values, sheetCloseAction(keypadState(initial), state) === 'save')
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.title}>{title}</AppText>
          <IconButton label="Close" accessibilityLabel="Close" accessibilityHint="Closes the keypad." onPress={close} />
        </View>
        <View style={styles.fields}>
          <Field title={weightTitle} text={fieldText(state, 'w')} active={state.field === 'w'} onPress={press('field:w')} />
          {fields.map(([id, name]) => (
            <Field key={id} title={name} text={fieldText(state, id)} active={state.field === id} onPress={press(`field:${id}`)} />
          ))}
        </View>
        <View style={styles.chips}>
          {CHIPS.map(chip => (
            <Key key={chip} text={chip.replace('-', '−')} label={`${chip.startsWith('-') ? 'Minus' : 'Plus'} ${chip.slice(1)} pounds`} minHeight={touch.primary} onPress={press(`chip:${chip}`)} />
          ))}
        </View>
        <View style={styles.grid}>
          {KEYS.map(key => (
            <Key key={key} text={key === 'back' ? '⌫' : key} label={key === 'back' ? 'Delete' : key === '.' ? 'Decimal point' : key} minHeight={touch.primary} onPress={press(key)} />
          ))}
        </View>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Pressable accessibilityRole="button" accessibilityLabel="Save" accessibilityHint="Keeps these numbers without completing the set." onPress={() => onSave(values)} style={styles.save}>
              <AppText variant="button">Save</AppText>
            </Pressable>
          </View>
          <View style={styles.action}>
            <PrimaryButton label="Complete" disabled={values.w === null} accessibilityHint={values.w === null ? 'Enter a weight first.' : 'Logs this set.'} onPress={() => onComplete(values)} />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.lg, padding: space.lg, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { flexShrink: 1 },
  fields: { flexDirection: 'row', gap: space.sm },
  field: { flex: 1, minHeight: touch.primary, gap: space.xs, padding: space.md, backgroundColor: color.field, borderColor: color.stroke, borderWidth: size.stroke, borderRadius: radius.md },
  fieldActive: { borderColor: color.text },
  chips: { flexDirection: 'row', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  key: { flexBasis: '31%', flexGrow: 1 },
  keyFace: { alignItems: 'center', justifyContent: 'center', backgroundColor: color.control, borderColor: color.stroke, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
  save: { minHeight: touch.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: color.control, borderColor: color.stroke, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md }
})
