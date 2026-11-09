import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { screenTopInset } from '../shell/tabs'
import { color, radius, space } from '../theme/tokens'
import AppText from './AppText'
import ScreenHeader from './ScreenHeader'

// Native tabs only inset the first ScrollView in a screen, so the body must be one.
export default function UnbuiltScreen({ title, phaseLabel, summary, status, children }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingTop: screenTopInset(Platform.OS) }]}
    >
      <ScreenHeader title={title} />
      {children}
      <View style={styles.card}>
        <AppText variant="label" color={color.textMuted}>{status}</AppText>
        {phaseLabel ? (
          <AppText variant="value" style={styles.phase}>{phaseLabel}</AppText>
        ) : null}
        <AppText variant="body" color={color.textSecondary}>{summary}</AppText>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl },
  card: {
    marginHorizontal: space.lg,
    padding: space.lg,
    gap: space.sm,
    backgroundColor: color.surface,
    borderColor: color.stroke,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg
  },
  phase: { marginBottom: space.xs }
})
