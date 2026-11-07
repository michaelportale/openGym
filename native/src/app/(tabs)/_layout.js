import { DynamicColorIOS } from 'react-native'
import { NativeTabs } from 'expo-router/native-tabs'
import { color } from '../../theme/tokens'

// Liquid Glass flips colours with the content behind it unless both appearances are pinned.
const pinned = value => DynamicColorIOS({ dark: value, light: value })

const TABS = [
  { name: 'index', label: 'Home', sf: { default: 'house', selected: 'house.fill' } },
  { name: 'plan', label: 'Plan', sf: { default: 'calendar', selected: 'calendar' } },
  // Workout pins its dock above the tab bar, so it applies its own insets with SafeAreaView.
  {
    name: 'workout',
    label: 'Workout',
    sf: { default: 'dumbbell', selected: 'dumbbell.fill' },
    disableAutomaticContentInsets: true
  },
  { name: 'progress', label: 'Progress', sf: { default: 'chart.bar', selected: 'chart.bar.fill' } },
  {
    name: 'exercises',
    label: 'Exercises',
    sf: { default: 'square.stack.3d.up', selected: 'square.stack.3d.up.fill' }
  }
]

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={pinned(color.accent)}
      iconColor={{ default: color.textSecondary, selected: color.accent }}
      labelStyle={{ color: pinned(color.textSecondary) }}
    >
      {TABS.map(t => (
        <NativeTabs.Trigger
          key={t.name}
          name={t.name}
          disableAutomaticContentInsets={t.disableAutomaticContentInsets}
        >
          <NativeTabs.Trigger.Icon sf={t.sf} />
          <NativeTabs.Trigger.Label>{t.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  )
}
