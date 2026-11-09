import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import PrimaryButton from '../ui/PrimaryButton'
import { parseWeight } from './weigh-in-view'

function SecondaryButton({ label, accessibilityHint, disabled, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondary, disabled && styles.disabled]}
    >
      <AppText variant="button" style={styles.centered}>{label}</AppText>
    </Pressable>
  )
}

// Type today's weight in pounds. `onSave(w)` and `onRemove()` resolve { ok }; a failure shows here
// and keeps the sheet open. "Remove today's weight" shows only when `canRemove`.
export default function LogWeightSheet({ visible, canRemove, onSave, onRemove, onClose }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const close = () => {
    if (busy) return
    setError(null)
    setText('')
    onClose()
  }

  const run = async action => {
    setBusy(true)
    setError(null)
    let result
    try {
      result = await action()
    } catch {
      result = { ok: false }
    }
    setBusy(false)
    if (result?.ok) {
      setText('')
      onClose()
    } else {
      setError(result?.error ?? "Couldn't save. Try again.")
    }
  }

  const save = () => {
    if (busy) return
    const w = parseWeight(text)
    if (w == null) {
      setError('Enter a weight in pounds.')
      return
    }
    run(() => onSave(w))
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={close}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.top}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.title}>Log weight</AppText>
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" alwaysBounceVertical={false}>
          <View style={styles.field}>
            <AppText variant="label" color={color.textSecondary}>Weight in pounds</AppText>
            <TextInput
              accessibilityLabel="Weight in pounds"
              accessibilityHint="Today's weight, for example 182.4."
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="182.4"
              placeholderTextColor={color.textMuted}
              keyboardType="decimal-pad"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={save}
              editable={!busy}
              maxFontSizeMultiplier={2.2}
            />
          </View>
          {error ? <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" color={color.text}>{error}</AppText> : null}
          <PrimaryButton
            label={busy ? 'Saving…' : 'Save'}
            accessibilityLabel={busy ? 'Saving' : 'Save'}
            accessibilityHint="Saves today's weight."
            disabled={busy}
            onPress={save}
          />
          {canRemove ? (
            <SecondaryButton label="Remove today's weight" accessibilityHint="Removes the weight you logged today." disabled={busy} onPress={() => run(onRemove)} />
          ) : null}
          <SecondaryButton label="Cancel" accessibilityHint="Closes without saving." disabled={busy} onPress={close} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.lg, paddingTop: space.lg, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg },
  title: { flexShrink: 1 },
  body: { flex: 1 },
  content: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.xl },
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
  disabled: { opacity: 0.5 },
  centered: { textAlign: 'center' }
})
