import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import LogWeightSheet from '../../body/LogWeightSheet'
import { useWeighIns } from '../../body/use-weigh-ins'
import { destinationCopy } from '../../shell/destinations'
import { color, space } from '../../theme/tokens'
import AppText from '../../ui/AppText'
import Card from '../../ui/Card'
import PrimaryButton from '../../ui/PrimaryButton'
import UnbuiltScreen from '../../ui/UnbuiltScreen'

const copy = destinationCopy('progress')

export default function Progress() {
  const { line, removable, save, remove } = useWeighIns()
  const [open, setOpen] = useState(false)
  return (
    <UnbuiltScreen title={copy.title} phaseLabel={copy.phaseLabel} summary={copy.summary} status={copy.status}>
      <Card style={styles.card}>
        <AppText variant="body" accessibilityLiveRegion="polite" color={color.text}>{line}</AppText>
        <PrimaryButton label="Log weight" accessibilityHint="Opens a sheet to type today's weight." onPress={() => setOpen(true)} />
      </Card>
      <View style={styles.gap} />
      <LogWeightSheet visible={open} canRemove={removable} onSave={save} onRemove={remove} onClose={() => setOpen(false)} />
    </UnbuiltScreen>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: space.lg, padding: space.lg, gap: space.md },
  gap: { height: space.lg }
})
