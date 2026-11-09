import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import NativeSymbol from '../ui/NativeSymbol'
import PrimaryButton from '../ui/PrimaryButton'
import ScaleButton from '../ui/ScaleButton'
import { draftChanged, sheetView, stepForm, withProg } from './plan-view'
import { slotForm } from './slot-edit'

function SecondaryButton({ label, accessibilityHint, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <AppText variant="button" style={styles.centered}>{label}</AppText>
    </Pressable>
  )
}

// − value +. VoiceOver reads it as one adjustable control: swipe up or down to change it.
function Stepper({ field, disabled, onStep }) {
  const canDown = !disabled && field.value > field.min
  const step = dir => {
    if (disabled || (dir < 0 && !canDown)) return
    onStep(dir)
  }
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={field.label}
      accessibilityValue={{ text: String(field.value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={styles.stepper}
    >
      <AppText variant="body" style={styles.grow}>{field.label}</AppText>
      <View style={styles.stepControls}>
        <ScaleButton accessibilityLabel={`Fewer ${field.label}`} disabled={!canDown} onPress={() => step(-1)} style={styles.stepHit} faceStyle={[styles.stepFace, !canDown && styles.disabled]}>
          <AppText variant="value">−</AppText>
        </ScaleButton>
        <AppText variant="value" style={styles.stepValue}>{field.value}</AppText>
        <ScaleButton accessibilityLabel={`More ${field.label}`} disabled={disabled} onPress={() => step(1)} style={styles.stepHit} faceStyle={[styles.stepFace, disabled && styles.disabled]}>
          <AppText variant="value">+</AppText>
        </ScaleButton>
      </View>
    </View>
  )
}

// One exercise of a routine. Mounted per open (the caller keys it), so the draft starts from the
// slot each time. Save hands the draft (slotForm) to onSave; Cancel writes nothing. Move up / Move
// down and Swap act at once through the caller: `moves.up` / `moves.down` are moveSlot results
// (null disables the button). While the draft has changes, Move and Swap wait for Save or Cancel,
// so typed numbers are never dropped. `message` is a refusal (the unsafe sentence) or a failed save.
// `onDismiss` runs once the sheet has gone (the caller pushes the swap picker then).
export default function SlotSheet({ visible, title, slot, routine, moves, message, busy, onSave, onMove, onSwap, onClose, onDismiss }) {
  const [initial] = useState(() => slotForm(slot, routine))
  const [form, setForm] = useState(initial)
  const view = sheetView(form, slot, routine)
  const dirty = draftChanged(slot, routine, initial, form)
  const close = () => {
    if (!busy) onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={close} onDismiss={onDismiss}>
      <View style={styles.sheet}>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.inset}>{title}</AppText>
        {/* Outside the scroll, so a refusal stays on screen while the buttons are scrolled to. */}
        {message ? (
          <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.inset}>{message}</AppText>
        ) : null}
        <ScrollView style={styles.body} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
          <View style={styles.pair}>
            <View style={styles.half}>
              <SecondaryButton label="Move up" accessibilityHint="Moves this exercise up one place and saves." disabled={busy || dirty || !moves.up} onPress={() => onMove(-1)} />
            </View>
            <View style={styles.half}>
              <SecondaryButton label="Move down" accessibilityHint="Moves this exercise down one place and saves." disabled={busy || dirty || !moves.down} onPress={() => onMove(1)} />
            </View>
          </View>
          <SecondaryButton label="Swap exercise" accessibilityHint="Opens the exercise list to pick a replacement." disabled={busy || dirty} onPress={onSwap} />
          {dirty ? (
            <AppText variant="label" color={color.textSecondary}>Save or cancel your changes to move or swap.</AppText>
          ) : null}

          {view.pyramid ? (
            <AppText variant="body" color={color.textSecondary}>Pyramid sets: edit them on the web</AppText>
          ) : (
            <View style={styles.group}>
              {view.fields.map(field => (
                <Stepper key={field.key} field={field} disabled={busy} onStep={dir => setForm(f => stepForm(f, field.key, dir))} />
              ))}
            </View>
          )}

          {view.choices ? (
            <View style={styles.group}>
              <AppText variant="label" color={color.textSecondary} accessibilityRole="header">Progression</AppText>
              {view.choices.map(c => (
                <Pressable
                  key={c.value || 'routine'}
                  accessibilityRole="button"
                  accessibilityLabel={c.label}
                  accessibilityState={{ selected: c.selected, disabled: Boolean(busy) }}
                  disabled={busy}
                  onPress={() => setForm(f => withProg(f, c.value, slot, routine))}
                  style={[styles.choice, c.selected && styles.choiceOn]}
                >
                  <AppText variant="body" style={styles.grow}>{c.label}</AppText>
                  {c.selected ? <NativeSymbol name="checkmark.circle.fill" tintColor={color.accent} size={size.icon} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}

          {view.editable ? (
            <>
              <PrimaryButton label="Save" accessibilityHint="Saves this exercise's settings." disabled={busy} onPress={() => onSave(form)} />
              <SecondaryButton label="Cancel" accessibilityHint="Closes without saving." disabled={busy} onPress={close} />
            </>
          ) : (
            <SecondaryButton label="Close" accessibilityHint="Closes this sheet." disabled={busy} onPress={close} />
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.md, paddingTop: space.lg, backgroundColor: color.bg },
  inset: { paddingHorizontal: space.lg },
  body: { flex: 1 },
  content: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.xl },
  // Side by side, and one above the other once large text needs the width.
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  half: { flexGrow: 1, flexBasis: 140 },
  group: { gap: space.sm },
  grow: { flexShrink: 1, flexGrow: 1 },
  stepper: {
    minHeight: touch.row,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.surface
  },
  stepControls: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginLeft: 'auto' },
  stepHit: { minWidth: touch.min, minHeight: touch.min, justifyContent: 'center' },
  stepFace: { minWidth: touch.min, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: color.control },
  stepValue: { minWidth: 36, textAlign: 'center' },
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
  choiceOn: { borderColor: color.accent, backgroundColor: color.surfaceActive },
  secondary: {
    minHeight: touch.row,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.stroke,
    backgroundColor: color.surface
  },
  pressed: { backgroundColor: color.surfaceActive },
  disabled: { opacity: 0.5 },
  centered: { textAlign: 'center' }
})
