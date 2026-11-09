import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import PrimaryButton from '../ui/PrimaryButton'
import { canPair } from './sync-triggers'

// Pair with your server: its address and the 8-character code from the Mac. `onPair(address, code)`
// resolves to the engine's { ok } or { ok:false, error }; an error shows here in words and keeps
// what was typed. The address field starts empty (the app shows the paired server elsewhere).
// Same pageSheet pattern as the keypad: fixed title row, a body that scrolls at large text sizes.
export default function PairSheet({ visible, onPair, onClose }) {
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const close = () => {
    if (busy) return
    setError(null)
    setCode('')
    onClose()
  }

  const submit = async () => {
    if (!canPair({ address, code, busy })) return
    setBusy(true)
    setError(null)
    let result
    try {
      result = await onPair(address, code)
    } catch {
      result = { ok: false, error: "Couldn't pair from this phone just now. Try again." }
    }
    setBusy(false)
    if (result?.ok) {
      setCode('')
      onClose()
    } else {
      setError(result?.error ?? "Couldn't pair. Try again.")
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={close}>
      <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.top}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.title}>Pair with your server</AppText>
          <IconButton label="Close" accessibilityLabel="Close" accessibilityHint="Closes without pairing." onPress={close} />
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" alwaysBounceVertical={false}>
          <AppText variant="body" color={color.textSecondary}>On the Mac that runs openGym, make a pairing code, then type its address and the code here. A code works once and lasts 5 minutes.</AppText>
          <View style={styles.field}>
            <AppText variant="label" color={color.textSecondary}>Server address</AppText>
            <TextInput
              accessibilityLabel="Server address"
              accessibilityHint="The address of your openGym server, for example https://gym.example.com or http://192.168.1.20:3000."
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder="https://gym.example.com"
              placeholderTextColor={color.textMuted}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="URL"
              returnKeyType="next"
              editable={!busy}
              maxFontSizeMultiplier={2.2}
            />
          </View>
          <View style={styles.field}>
            <AppText variant="label" color={color.textSecondary}>Pairing code</AppText>
            <TextInput
              accessibilityLabel="Pairing code"
              accessibilityHint="The 8 character code from the Mac."
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder="8 characters"
              placeholderTextColor={color.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              spellCheck={false}
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={submit}
              editable={!busy}
              maxFontSizeMultiplier={2.2}
            />
          </View>
          {error ? <AppText variant="body" accessibilityRole="alert" accessibilityLiveRegion="polite" color={color.text}>{error}</AppText> : null}
          <PrimaryButton
            label={busy ? 'Pairing…' : 'Pair'}
            accessibilityLabel={busy ? 'Pairing' : 'Pair'}
            accessibilityHint="Pairs this phone with the server."
            disabled={!canPair({ address, code, busy })}
            onPress={submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.lg, paddingTop: space.lg, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg },
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
  }
})
