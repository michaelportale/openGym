import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { color, space } from '../theme/tokens'
import AppText from './AppText'
import IconButton from './IconButton'

export default function ScreenHeader({ title, subtitle }) {
  const router = useRouter()
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <AppText variant="wordmark">openGym</AppText>
        <IconButton
          symbol="ellipsis.circle"
          accessibilityLabel="More"
          onPress={() => router.push('/diagnostics')}
        />
      </View>
      <AppText variant="title" accessibilityRole="header">{title}</AppText>
      {subtitle ? (
        <AppText variant="body" color={color.textSecondary} style={styles.subtitle}>{subtitle}</AppText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingBottom: space.lg },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subtitle: { marginTop: space.xs }
})
