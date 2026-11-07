import { Pressable, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { SymbolView } from 'expo-symbols'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from './AppText'
import { usePressScale } from './use-press-scale'

// Shows a symbol, or a short label for an action with no icon (the rest timer's "+30s").
export default function IconButton({ symbol, label, accessibilityLabel, onPress }) {
  const press = usePressScale()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      {...press.handlers}
    >
      <Animated.View style={[styles.button, press.style]}>
        {label ? (
          <AppText variant="value">{label}</AppText>
        ) : (
          <SymbolView name={symbol} tintColor={color.text} size={size.icon} />
        )}
      </Animated.View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    minWidth: touch.min,
    minHeight: touch.min,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.control,
    borderColor: color.stroke,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm
  }
})
