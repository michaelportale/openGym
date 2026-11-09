import { useState } from 'react'
import { Platform, ScrollView, StyleSheet } from 'react-native'
import LogWeightSheet from '../../body/LogWeightSheet'
import { useWeighIns } from '../../body/use-weigh-ins'
import ProgressBody from '../../progress/ProgressBody'
import { screenTopInset } from '../../shell/tabs'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import PrimaryButton from '../../ui/PrimaryButton'
import ScreenHeader from '../../ui/ScreenHeader'

export default function Progress() {
  const { line, removable, save, remove } = useWeighIns()
  const [open, setOpen] = useState(false)
  // The sheet sits beside the screen's ScrollView, not in it: inside, the ScrollView took the first
  // tap while the keyboard was up, so Save or Remove only dismissed the keyboard. Native tabs only
  // inset the first ScrollView in a screen, so the body is one.
  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { paddingTop: screenTopInset(Platform.OS) }]}
      >
        <ScreenHeader title="Progress" />
        <ProgressBody>
          <AppText variant="body" accessibilityLiveRegion="polite" color={color.text}>{line}</AppText>
          <PrimaryButton label="Log weight" accessibilityHint="Opens a sheet to type today's weight." onPress={() => setOpen(true)} />
        </ProgressBody>
      </ScrollView>
      <LogWeightSheet visible={open} canRemove={removable} onSave={save} onRemove={remove} onClose={() => setOpen(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: color.bg },
  content: { paddingBottom: space.xl }
})
