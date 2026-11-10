import { StyleSheet, TextInput, View } from 'react-native'
import { color, radius, space, touch } from '../theme/tokens'
import AppText from './AppText'

// One labelled number field with its unit after it (the web's measure-field row). The text is the
// caller's; it is read back with ui/number-text.js parseNumberText. `decimal` false shows the
// number pad without a point (calories are whole).
export default function NumberRow({ label, unit, accessibilityLabel, value, onChangeText, decimal = true, editable = true }) {
  return (
    <View style={styles.row}>
      <AppText variant="body" style={styles.grow}>{label}</AppText>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
        selectTextOnFocus
        editable={editable}
        placeholder="–"
        placeholderTextColor={color.textMuted}
        maxFontSizeMultiplier={2.2}
      />
      <AppText variant="label" color={color.textSecondary} style={styles.unit}>{unit}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: touch.row, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  grow: { flexShrink: 1, flexGrow: 1 },
  input: {
    minHeight: touch.min,
    minWidth: 96,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.stroke,
    backgroundColor: color.field,
    color: color.text,
    fontSize: 17,
    textAlign: 'right'
  },
  unit: { minWidth: 32 }
})
