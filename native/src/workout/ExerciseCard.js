import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { color, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import { poppedSetIds, statusBySetId } from '../ui/done-transition'
import IconButton from '../ui/IconButton'
import ScaleButton from '../ui/ScaleButton'
import WhySheet from './WhySheet'
import { whyEntry } from './why-entry'
import SetRow, { SetTableHeader } from './SetRow'

// An add control: a plus button with its words beside it (hidden from VoiceOver, which reads
// the button's own label).
function AddRow({ label, hint, onPress, style }) {
  return (
    <View style={[styles.addRow, style]}>
      <IconButton symbol="plus" accessibilityLabel={label} accessibilityHint={hint} onPress={onPress} />
      <AppText variant="body" color={color.textSecondary} accessibilityElementsHidden style={styles.addLabel}>
        {label}
      </AppText>
    </View>
  )
}

const LOADS_WHY = whyEntry('warmup-loads')
const PROMPT_WHY = whyEntry('warmup-prompt')

// The suggested warm-up loads for the first exercise of a body part, with one tap to add both and
// the reasons behind them. `prompt.text` is the loads in words (warmupPromptText).
function WarmupPrompt({ prompt, onAdd }) {
  const [why, setWhy] = useState(null)
  return (
    <View style={styles.prompt}>
      <AppText variant="body" accessibilityLiveRegion="polite">{prompt.text}</AppText>
      <View style={styles.promptActions}>
        <IconButton label="Add warm-ups" accessibilityLabel="Add warm-ups" accessibilityHint="Adds both suggested warm-up sets. You complete each one. Warm-ups do not count as sets." onPress={onAdd} />
        <ScaleButton accessibilityLabel="Why these warm-up loads?" accessibilityHint="Shows where these loads come from." onPress={() => setWhy('loads')} style={styles.why} faceStyle={styles.whyFace}>
          <AppText variant="label" color={color.textSecondary}>Why?</AppText>
        </ScaleButton>
        <ScaleButton accessibilityLabel="Why a warm-up is offered?" accessibilityHint="Shows why this exercise is suggested a warm-up." onPress={() => setWhy('prompt')} style={styles.why} faceStyle={styles.whyFace}>
          <AppText variant="label" color={color.textSecondary}>Why offered?</AppText>
        </ScaleButton>
      </View>
      <WhySheet visible={why === 'loads'} entry={LOADS_WHY} onClose={() => setWhy(null)} />
      <WhySheet visible={why === 'prompt'} entry={PROMPT_WHY} onClose={() => setWhy(null)} />
    </View>
  )
}

// Props come from `workoutScreen(...).card`. `onPressRow(setId, field)` opens the keypad. Warm-ups
// come before the work sets, so their add control sits above the table. `perHand` makes the rows
// say "each" after the weight.
export default function ExerciseCard({ name, category, noHistory, rows, weightTitle, perHand, onPressRow, onAddSet, onAddWarmup, warmupPrompt, onAddWarmups }) {
  // The last statuses shown; a remounted card (another exercise, a reopen) starts empty and pops nothing.
  const shown = useRef(null)
  const popped = poppedSetIds(shown.current, rows)
  useEffect(() => { shown.current = statusBySetId(rows) })
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        {category ? <AppText variant="label" color={color.textSecondary}>{category}</AppText> : null}
        <AppText variant="screenTitle" accessibilityRole="header">{name}</AppText>
        {noHistory ? <AppText variant="body" color={color.textSecondary}>No history yet</AppText> : null}
      </View>
      {warmupPrompt ? <WarmupPrompt prompt={warmupPrompt} onAdd={onAddWarmups} /> : null}
      <AddRow label="Add warm-up" hint="Adds a warm-up set. Warm-ups do not count as sets." onPress={onAddWarmup} style={styles.addWarmup} />
      <SetTableHeader weightTitle={weightTitle} />
      {rows.map(row => <SetRow key={row.setId} {...row} pop={popped.has(row.setId)} perHand={perHand} onPress={onPressRow} />)}
      <AddRow label="Add set" hint="Adds one more set to this exercise." onPress={onAddSet} style={styles.addSet} />
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.sm, paddingTop: space.lg, paddingBottom: space.sm },
  heading: {
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
    borderBottomColor: color.stroke,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm },
  addWarmup: { paddingVertical: space.sm },
  addSet: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopColor: color.stroke,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  prompt: { gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm },
  promptActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  why: { minWidth: touch.min, minHeight: touch.min },
  whyFace: { minWidth: touch.min, minHeight: touch.min, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  addLabel: { flexShrink: 1 }
})
