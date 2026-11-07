import { Text, View } from 'react-native'
import { color, space, type } from '../../theme/tokens.js'
import { whySheetModel } from '../why-sheet.js'

/**
 * Presentational Why-this sheet. Pass the object whyThis() returns.
 * Not mounted by any screen in this lane.
 */
export function WhyThisSheet({ payload }) {
  const model = whySheetModel(payload)
  return (
    <View
      accessibilityRole="summary"
      style={{ backgroundColor: color.surface, padding: space.lg, gap: space.sm }}
    >
      {model.label ? (
        <Text style={{ color: color.accent, ...type.label }}>{model.label}</Text>
      ) : null}
      <Text style={{ color: color.text, ...type.body }}>{model.reason}</Text>
      <Text style={{ color: color.textSecondary, ...type.body }}>{model.source}</Text>
    </View>
  )
}
