import { useEffect } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { color, radius, size, space, touch } from '../theme/tokens'
import NativeSymbol from '../ui/NativeSymbol'
import AppText from '../ui/AppText'
import ScaleButton from '../ui/ScaleButton'
import { useMotion } from '../ui/use-motion'
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

// A number in a box on an open row. It opens the keypad on its own field. `look` is 'boxed' on the
// current work set and 'filled' on an open warm-up, which must not look current beside it.
function Box({ text, label, hint, look, onPress }) {
  return (
    <ScaleButton accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} style={styles.amount} faceStyle={styles[look]}>
      <AppText variant="value">{text}</AppText>
    </ScaleButton>
  )
}

// On an open row VoiceOver stops on the summary and the two boxes; the summary already says the
// Last value and the done mark, so those cells are not stops of their own.
const HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' }

// The marker, popping in (scale and fade) when `pop` is set: the card saw this set open and the
// view now shows it done, which only happens after the durable write. The card decides, because
// this row swaps its root element when it stops being open and so remounts. Nothing waits on it;
// a new pop retargets the running one. The zero-length first step starts it from 0.
function Marker({ pop, children }) {
  const { duration } = useMotion()
  const ms = duration('press')
  const progress = useSharedValue(pop && ms > 0 ? 0 : 1)
  useEffect(() => {
    if (pop && ms > 0) progress.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: ms }))
  }, [pop])
  const style = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * progress.value, transform: [{ scale: 0.7 + 0.3 * progress.value }] }))
  return <Animated.View style={style}>{children}</Animated.View>
}

const plain = (text, tone) => <AppText variant="value" color={tone}>{text}</AppText>

// Takes a row of `workoutScreen(...).card.rows`. `onPress(setId, field)` opens the keypad
// ('w' or 'r'); on a done or pending row the whole row is the target. `sideDone` marks a
// per-side set with one side logged. `label` is the set number, or 'W' on a warm-up. `perHand`
// says the weight is per hand. `pop` animates the Done mark (see Marker).
export default function SetRow({ setId, number, label, warmup, perSide, perHand, weightText, repsText, lastText, status, sideDone, pop, onPress }) {
  const view = setRowView({ number, weight: weightText, reps: repsText, status, lastText, sideDone, warmup, perSide, perHand })
  const marker = MARKERS[view.marker]
  const tone = status === 'done' ? color.textSecondary : color.text
  const open = view.fields !== 'plain'
  const cells = (
    <>
      <View
        {...(open ? { accessible: true, accessibilityLabel: view.accessibilityLabel } : null)}
        style={styles.number}
      >
        {plain(label ?? number, color.textSecondary)}
      </View>
      {open ? (
        <>
          <Box text={view.weightText} label={view.weightLabel} hint="Opens the keypad." look={view.fields} onPress={() => onPress?.(setId, 'w')} />
          <Box text={view.repsText} label={view.repsLabel} hint="Opens the keypad." look={view.fields} onPress={() => onPress?.(setId, 'r')} />
        </>
      ) : (
        <>
          <View style={styles.amount}>{plain(view.weightText, tone)}</View>
          <View style={styles.amount}>{plain(view.repsText, tone)}</View>
        </>
      )}
      {/* One line: a long or per-side value shrinks to fit rather than wrapping. */}
      <View {...(open ? HIDDEN : null)} style={styles.last}>
        <AppText variant="value" color={color.textMuted} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={styles.lastText}>
          {view.lastText}
        </AppText>
      </View>
      <View {...(open ? HIDDEN : null)} style={[styles.done, styles.marker]}>
        {view.sideMark ? (
          <AppText variant="value" color={color.accent} numberOfLines={1} adjustsFontSizeToFit>
            {view.sideMark.text}
          </AppText>
        ) : (
          <Marker pop={pop}>
            <NativeSymbol name={marker.name} tintColor={marker.tint} weight={marker.weight} size={size.marker} />
          </Marker>
        )}
      </View>
    </>
  )
  if (open) {
    // The boxed numbers are their own buttons, so the row itself must not swallow them;
    // the set number carries the spoken summary. Only the current work set is highlighted.
    return (
      <View accessible={false} style={[styles.columns, styles.row, view.fields === 'boxed' ? styles.currentRow : styles.openRow]}>
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
  openRow: { paddingVertical: space.sm },
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
  // An open warm-up: a quiet field, not the current set. Its fill all but matches the card, so the
  // box is its outline: the strong stroke (3:1 on the card, tokens.test.js), but a hairline on a
  // plain row, where the current set has a full stroke on a highlighted row.
  filled: {
    minWidth: '100%',
    minHeight: touch.row,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.field,
    borderColor: color.strokeStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm
  },
  done: { flex: 1, minWidth: touch.min },
  marker: { minHeight: touch.row, alignItems: 'center', justifyContent: 'center' }
})
