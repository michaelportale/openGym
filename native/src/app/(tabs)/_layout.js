import { useEffect } from 'react'
import { DynamicColorIOS, Platform } from 'react-native'
import { NativeTabs } from 'expo-router/native-tabs'
import { TABS, installWebTabFit, pinnedTabColor, tabBarColors, tabLabelStyle } from '../../shell/tabs'

// Liquid Glass flips colours unless both appearances are pinned. Web keeps the hex.
const pin = value => pinnedTabColor(value, Platform.OS, DynamicColorIOS)
const bar = tabBarColors()
const labels = tabLabelStyle(Platform.OS)

export default function TabsLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') installWebTabFit(globalThis.document)
  }, [])
  return (
    <NativeTabs
      tintColor={pin(bar.tintColor)}
      backgroundColor={pin(bar.backgroundColor)}
      iconColor={{ default: pin(bar.iconColor.default), selected: pin(bar.iconColor.selected) }}
      labelStyle={{
        default: { ...labels.default, color: pin(labels.default.color) },
        selected: { ...labels.selected, color: pin(labels.selected.color) }
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
