import { useState } from 'react'
import { Platform, Pressable, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { SymbolView } from 'expo-symbols'
import { color, radius, size, space, touch } from '../theme/tokens'
import AppText from './AppText'
import { focusRingStyle } from './focus-ring'
import { usePressScale } from './use-press-scale'

// Shows a symbol, or a short label for an action with no icon (the rest timer's "+30s").
export default function IconButton({ symbol, label, accessibilityLabel, accessibilityHint, onPress }) {
  const press = usePressScale()
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: false }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...press.handlers}
    >
      <Animated.View style={[styles.button, focusRingStyle(focused, Platform.OS, color.accent), press.style]}>
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
