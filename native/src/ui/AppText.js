import { Text } from 'react-native'
import { color as colors, fontScale, type } from '../theme/tokens'

export default function AppText({ variant = 'body', color = colors.text, style, children, ...rest }) {
  return (
    <Text
      maxFontSizeMultiplier={fontScale[variant]}
      {...rest}
      style={[type[variant], { color }, style]}
    >
      {children}
    </Text>
  )
}
