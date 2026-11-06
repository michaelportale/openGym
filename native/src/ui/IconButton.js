import { Pressable, StyleSheet } from 'react-native'
import { SymbolView } from 'expo-symbols'
import { color, touch } from '../theme/tokens'

export default function IconButton({ symbol, accessibilityLabel, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={0}
      style={styles.button}
    >
      <SymbolView name={symbol} tintColor={color.text} size={22} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    width: touch.min,
    height: touch.min,
    alignItems: 'center',
    justifyContent: 'center'
  }
})
