import { useEffect } from 'react'
import { Stack, ThemeProvider, DarkTheme, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { onRestAlertTap, setRestAlertHandler } from '../notify/notifications'
import { color } from '../theme/tokens'

export const unstable_settings = { anchor: '(tabs)' }

// A rest alert arriving while the app is open is not presented: the dock shows the rest ending.
setRestAlertHandler()

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: color.bg, card: color.bg }
}

export default function RootLayout() {
  // A tap on a rest alert opens the Workout tab and writes nothing: the screen there reads the
  // journal as it always does.
  useEffect(() => onRestAlertTap(() => router.navigate('/')), [])
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
