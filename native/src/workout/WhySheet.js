import { Modal, ScrollView, StyleSheet, View } from 'react-native'
import { color, space } from '../theme/tokens'
import AppText from '../ui/AppText'
import IconButton from '../ui/IconButton'
import { WhyThisSheet } from '../science/components/WhyThisSheet'

// A "Why this?" sheet for one register entry (whyEntry). Read-only: it never writes. Same pageSheet
// pattern as the keypad: a fixed title row with Close, and a body that scrolls so every line can be
// reached at the largest text sizes. Rendered inside another Modal it presents on top of it.
export default function WhySheet({ visible, entry, onClose }) {
  if (!entry) return null
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.top}>
          <AppText variant="screenTitle" accessibilityRole="header" style={styles.title}>{entry.title}</AppText>
          <IconButton label="Close" accessibilityLabel="Close" accessibilityHint="Closes this explanation." onPress={onClose} />
        </View>
        <ScrollView style={styles.body} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
          <WhyThisSheet payload={entry.payload()} />
          <AppText variant="label" color={color.textSecondary}>General training information, not medical advice.</AppText>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  sheet: { flex: 1, gap: space.lg, paddingTop: space.lg, backgroundColor: color.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg },
  title: { flexShrink: 1 },
  body: { flex: 1 },
  content: { gap: space.lg, paddingHorizontal: space.lg, paddingBottom: space.lg }
})
