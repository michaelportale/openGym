import { ScrollView, StyleSheet, View } from 'react-native'
import { space } from '../theme/tokens'
import AppText from '../ui/AppText'
import Card from '../ui/Card'
import PrimaryButton from '../ui/PrimaryButton'
import ScreenHeader from '../ui/ScreenHeader'
import ExportButton from './ExportButton'

// After Finish. The phone holds the only copy until sync exists, so Export sits right here.
export default function SavedScreen({ db, onDone }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <ScreenHeader title="Workout" />
      <View style={styles.body}>
        <Card accessibilityLiveRegion="polite" style={styles.card}>
          <AppText variant="heading">Saved on this phone. Not synced yet.</AppText>
        </Card>
        <ExportButton db={db} />
        <PrimaryButton label="Done" accessibilityHint="Goes back to the start of the Workout tab." onPress={onDone} />
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: space.xl },
  body: { gap: space.lg, paddingHorizontal: space.lg },
  card: { padding: space.lg }
})
