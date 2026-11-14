import React from 'react'
import { registerRootComponent } from 'expo'
import Constants from 'expo-constants'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import * as NavigationBar from 'expo-navigation-bar'
import { View } from 'react-native'
import { ShellFixture } from './ShellFixture'
import { WorkFixture } from './WorkFixture'
import { AgentFixture } from './AgentFixture'
import { ChatFixture } from './ChatFixture'
import { ResourceFixture } from './ResourceFixture'
import { SettingsFixture, SETTINGS_FIXTURE_SCREENS } from './SettingsFixture'

void NavigationBar.setVisibilityAsync('hidden')

function NativeShellPreview() {
  const [loaded] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Geist: require('@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GeistMedium: require('@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    GeistSemibold: require('@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf'),
  })
  const preview = Constants.expoConfig?.extra?.shellPreview
  const Fixture = ['work-list', 'task-detail', 'new-task'].includes(preview?.screen)
    ? WorkFixture
    : ['agent-stream', 'agent-approval', 'agent-details', 'agent-editor'].includes(preview?.screen)
      ? AgentFixture
    : ['personal-new', 'personal-stream', 'model-picker', 'channel-room', 'message-thread'].includes(preview?.screen)
      ? ChatFixture
    : ['activity-feed', 'files-list', 'note', 'file-preview', 'automations-list', 'automation-detail', 'search-mentions'].includes(preview?.screen)
      ? ResourceFixture
    : SETTINGS_FIXTURE_SCREENS.includes(preview?.screen) ? SettingsFixture : ShellFixture
  return (
    <View style={{ flex: 1 }}>
      <StatusBar hidden />
      {loaded ? (
        <Fixture initialScreen={preview?.screen ?? 'boot'} dark={preview?.theme === 'dark'} />
      ) : null}
    </View>
  )
}

registerRootComponent(NativeShellPreview)
