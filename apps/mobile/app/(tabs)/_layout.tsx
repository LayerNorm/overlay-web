import React from 'react'
import { DynamicColorIOS, Platform } from 'react-native'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import { useTheme } from '../../hooks/useTheme'

function dynamicTabColor(light: string, dark: string): string {
  if (Platform.OS !== 'ios') {
    return light
  }

  return DynamicColorIOS({ light, dark }) as unknown as string
}

export default function TabLayout(): React.ReactElement {
  const { theme } = useTheme()
  const tintColor = dynamicTabColor('#111111', '#FFFFFF')
  const mutedColor = dynamicTabColor('#737373', '#A3A3A3')

  return (
    <NativeTabs
      backgroundColor={dynamicTabColor('rgba(250, 250, 249, 0.82)', 'rgba(18, 18, 18, 0.82)')}
      blurEffect="systemChromeMaterial"
      disableTransparentOnScrollEdge
      iconColor={{ default: mutedColor, selected: tintColor }}
      tintColor={tintColor}
      labelStyle={{
        color: mutedColor,
        fontSize: 11,
        fontWeight: '600',
      }}
      minimizeBehavior="never"
      shadowColor={theme.border}
    >
      <NativeTabs.Trigger name="index" hidden />
      <NativeTabs.Trigger
        name="chat"
        options={{
          title: 'Chat',
          icon: { sf: 'message' },
          selectedIcon: { sf: 'message.fill' },
        }}
      />
    </NativeTabs>
  )
}
