import React from 'react'
import { Form, Host, Picker, Section, Text } from '@expo/ui/swift-ui'
import { pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'
import { MODE_OPTIONS, useMode, type AppMode } from '../../contexts/ModeContext'
import { TabToolbar } from './nativeHeader'

/**
 * The Mode tab's page. On iPhone the tab's circle opens a menu instead, so this
 * page is reached on iPad (where the tabs are a top bar or sidebar) and by
 * VoiceOver.
 */
export function ModeScreen() {
  const { theme, isDark } = useTheme()
  const { mode, setMode } = useMode()
  return (
    <>
      <TabToolbar />
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          <Section
            footer={
              <Text>
                Workspace shows what your workspace shares. Personal is your private corner of this workspace: your own
                agents, chats, files and automations, and your own chief.
              </Text>
            }
          >
            <Picker
              selection={mode}
              onSelectionChange={(value: AppMode) => setMode(value)}
              modifiers={[pickerStyle('inline')]}
            >
              {MODE_OPTIONS.map((option) => (
                <Text key={option.value} modifiers={[tag(option.value)]}>
                  {option.label}
                </Text>
              ))}
            </Picker>
          </Section>
        </Form>
      </Host>
    </>
  )
}
