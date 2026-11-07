import { DynamicColorIOS, Platform } from 'react-native'
import { NativeTabs } from 'expo-router/native-tabs'
import { TABS, pinnedTabColor, tabBarColors } from '../../shell/tabs'

// Liquid Glass flips colours unless both appearances are pinned. Web keeps the hex.
const pin = value => pinnedTabColor(value, Platform.OS, DynamicColorIOS)
const bar = tabBarColors()

export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={pin(bar.tintColor)}
      iconColor={{ default: pin(bar.iconColor.default), selected: pin(bar.iconColor.selected) }}
      labelStyle={{
        default: { color: pin(bar.labelStyle.default.color) },
        selected: { color: pin(bar.labelStyle.selected.color) }
      }}
    >
      {TABS.map(tab => (
        <NativeTabs.Trigger
          key={tab.name}
          name={tab.name}
          accessibilityLabel={tab.label}
          {...(tab.disableAutomaticContentInsets ? { disableAutomaticContentInsets: true } : {})}
        >
          <NativeTabs.Trigger.Icon sf={tab.sf} />
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  )
}
