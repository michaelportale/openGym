import { useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { color, radius, size, space, touch } from '../theme/tokens'
import NativeSymbol from '../ui/NativeSymbol'
import AppText from '../ui/AppText'
import { focusRingStyle } from '../ui/focus-ring'
import { usePressScale } from '../ui/use-press-scale'
import { setRowView } from './set-row-view'

const MARKERS = {
  checked: { name: 'checkmark.circle.fill', tint: color.accent, weight: 'regular' },
  open: { name: 'square', tint: color.strokeStrong, weight: 'semibold' },
  empty: { name: 'square', tint: color.strokeStrong, weight: 'regular' }
}

const COLUMN_TITLES = [['Set', 'number'], ['Lb', 'amount'], ['Reps', 'amount'], ['Last', 'last'], ['Done', 'done']]

// Lines up with SetRow's columns. Hidden from VoiceOver because each row says it all.
// `weightTitle` is 'Lb each' when the exercise is per hand.
export function SetTableHeader({ weightTitle = 'Lb' }) {
  return (
    <View accessibilityElementsHidden style={[styles.columns, styles.header]}>
      {COLUMN_TITLES.map(([title, column]) => (
        <AppText
          key={title}
          variant="label"
          color={color.textMuted}
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles[column], styles.title]}
        >
          {title === 'Lb' ? weightTitle : title}
        </AppText>
      ))}
    </View>
  )
}

// A boxed number on the current row. It opens the keypad on its own field.
function Box({ text, label, hint, onPress }) {
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
      style={styles.amount}
      {...press.handlers}
    >
      <Animated.View style={[styles.boxed, focusRingStyle(focused, Platform.OS, color.accent), press.style]}>
        <AppText variant="value">{text}</AppText>
      </Animated.View>
    </Pressable>
  )
}

const plain = (text, tone) => <AppText variant="value" color={tone}>{text}</AppText>

// Takes a row of `workoutScreen(...).card.rows`. `onPress(setId, field)` opens the keypad
// ('w' or 'r'); on a done or pending row the whole row is the target. `sideDone` marks a
// per-side set with one side logged.
export default function SetRow({ setId, number, weightText, repsText, lastText, status, sideDone, onPress }) {
  const view = setRowView({ number, weight: weightText, reps: repsText, status, lastText, sideDone })
  const marker = MARKERS[view.marker]
  const tone = status === 'done' ? color.textSecondary : color.text
  const current = view.fields === 'boxed'
  const cells = (
    <>
      <View
        {...(current ? { accessible: true, accessibilityLabel: view.accessibilityLabel } : null)}
        style={styles.number}
      >
        {plain(number, color.textSecondary)}
      </View>
      {current ? (
        <>
          <Box text={view.weightText} label={`Weight, ${weightText === '–' ? 'not set' : `${weightText} pounds`}`} hint="Opens the keypad." onPress={() => onPress?.(setId, 'w')} />
          <Box text={view.repsText} label={`Reps, ${repsText}`} hint="Opens the keypad." onPress={() => onPress?.(setId, 'r')} />
        </>
      ) : (
        <>
          <View style={styles.amount}>{plain(view.weightText, tone)}</View>
          <View style={styles.amount}>{plain(view.repsText, tone)}</View>
        </>
      )}
      {/* One line: a long or per-side value shrinks to fit rather than wrapping. */}
      <View style={styles.last}>
        <AppText variant="value" color={color.textMuted} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.lastText}>
          {view.lastText}
        </AppText>
      </View>
      <View style={[styles.done, styles.marker]}>
        {view.sideMark ? (
          <AppText variant="value" color={color.accent} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={view.sideMark.label}>
            {view.sideMark.text}
          </AppText>
        ) : (
          <NativeSymbol name={marker.name} tintColor={marker.tint} weight={marker.weight} size={size.marker} />
        )}
      </View>
    </>
  )
  if (current) {
    // The boxed numbers are their own buttons, so the row itself must not swallow them;
    // the set number carries the spoken summary.
    return (
      <View accessible={false} style={[styles.columns, styles.row, styles.currentRow]}>
        {cells}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={view.accessibilityLabel}
      accessibilityHint={status === 'done' ? 'Opens the keypad to change or undo this set.' : 'Opens the keypad.'}
      onPress={() => onPress?.(setId, 'w')}
      style={[styles.columns, styles.row]}
    >
      {cells}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  columns: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm },
  header: {
    paddingVertical: space.sm,
    borderBottomColor: color.stroke,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  title: { textAlign: 'center' },
  row: { minHeight: touch.row, borderRadius: radius.sm },
  currentRow: { paddingVertical: space.sm, backgroundColor: color.surfaceActive },
  number: { flex: 1, alignItems: 'center' },
  amount: { flex: 2, alignItems: 'center', justifyContent: 'center' },
  last: { flex: 2, alignItems: 'center' },
  lastText: { alignSelf: 'stretch', textAlign: 'center' },
  boxed: {
    minWidth: '100%',
    minHeight: touch.row,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.field,
    borderColor: color.strokeStrong,
    borderWidth: size.stroke,
    borderRadius: radius.sm
  },
  done: { flex: 1, minWidth: touch.min },
  marker: { minHeight: touch.row, alignItems: 'center', justifyContent: 'center' }
})
