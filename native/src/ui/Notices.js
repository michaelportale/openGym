import { StyleSheet } from 'react-native'
import { color, space, touch } from '../theme/tokens'
import AppText from './AppText'
import Card from './Card'
import ScaleButton from './ScaleButton'

// The edits that were not sent, each with Dismiss. `lines` are { rid, text, dismissLabel }: the
// Plan tab's from plan-view.js noticeLines, the Nutrition screen's from nutrition-screen.js
// nutritionNotices. onDismiss(rid).
export default function Notices({ lines, onDismiss }) {
  return lines.map(n => (
    <Card key={n.rid} style={styles.notice}>
      <AppText variant="body">{n.text}</AppText>
      <ScaleButton
        accessibilityLabel={n.dismissLabel}
        accessibilityHint="Hides this notice."
        onPress={() => onDismiss(n.rid)}
        style={styles.dismiss}
        faceStyle={styles.dismissFace}
      >
        <AppText variant="label" color={color.accent}>Dismiss</AppText>
      </ScaleButton>
    </Card>
  ))
}

const styles = StyleSheet.create({
  notice: { marginHorizontal: space.lg, marginBottom: space.lg, padding: space.lg, gap: space.sm },
  dismiss: { minHeight: touch.min, alignSelf: 'flex-start', justifyContent: 'center' },
  dismissFace: { paddingHorizontal: space.sm, marginLeft: -space.sm }
})
