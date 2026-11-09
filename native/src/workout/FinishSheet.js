import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import PrimaryButton from '../ui/PrimaryButton'

function Figure({ title, text }) {
  return (
    <View accessible accessibilityLabel={`${title}, ${text}`} style={styles.figure}>
      <AppText variant="label" color={color.textSecondary}>{title}</AppText>
      <AppText variant="value">{text}</AppText>
    </View>
  )
}

// Finish confirmation with the summary. `summary` is finishSummary(view). `endsAtLastSet` is the
// overnight finish, which ends at the last logged work instead of now. Discard is its own,
// destructive confirmation (the caller's).
export default function FinishSheet({ visible, title, summary, endsAtLastSet, notice, busy, onConfirm, onDiscard, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.title}>{`Finish ${title}?`}</AppText>
          <IconButton label="Cancel" accessibilityLabel="Cancel" accessibilityHint="Goes back to the workout." onPress={onClose} />
        </View>
        {summary ? (
          <View style={styles.figures}>
            <Figure title="Done" text={summary.setsText} />
            <Figure title="Volume" text={summary.volumeText} />
            <Figure title="Time" text={summary.durationText} />
          </View>
        ) : null}
        {endsAtLastSet ? (
          <AppText variant="body" color={color.textSecondary}>It ends at the last set you logged.</AppText>
        ) : null}
        {notice ? (
          <AppText variant="body" accessibilityLiveRegion="polite" accessibilityRole="alert">{notice}</AppText>
        ) : null}
        <PrimaryButton label="Save workout" disabled={busy} accessibilityHint="Saves this workout on this phone." onPress={onConfirm} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard workout"
          accessibilityHint="Asks before deleting this workout."
          onPress={onDiscard}
          style={styles.discard}
        >
          <AppText variant="button" color={color.textSecondary}>Discard workout</AppText>
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.lg, padding: space.lg, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  title: { flexShrink: 1 },
  figures: { flexDirection: 'row', gap: space.sm },
  figure: { flex: 1, gap: space.xs, padding: space.md, backgroundColor: color.surface, borderColor: color.stroke, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  discard: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center' }
})
