import { Platform, StyleSheet } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { symbolPresentation } from './symbol-fallback'
import AppText from './AppText'

// iOS draws the SF Symbol. Other platforms draw the text glyph: expo-symbols
// leaves a string name blank there, and these parents already name the control.
export default function NativeSymbol({ name, tintColor, size, weight }) {
  const presentation = symbolPresentation(name, Platform.OS)
  if (presentation.kind === 'sf-symbol') {
    return <SymbolView name={presentation.name} tintColor={tintColor} size={size} weight={weight} />
  }
  return (
    <AppText
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, { color: tintColor, fontSize: size, lineHeight: size }]}
    >
      {presentation.text}
    </AppText>
  )
}

const styles = StyleSheet.create({
  glyph: { fontWeight: '700', textAlign: 'center' }
})
