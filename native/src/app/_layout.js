import { Stack, ThemeProvider, DarkTheme } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { color } from '../theme/tokens'

export const unstable_settings = { anchor: '(tabs)' }

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: color.bg, card: color.bg }
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="diagnostics" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  )
}
