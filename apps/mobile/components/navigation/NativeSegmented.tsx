import React from 'react'
import { Host, Picker, Text } from '@expo/ui/swift-ui'
import { disabled as disabledModifier, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'

/**
 * The app's one segmented control: the system control (SwiftUI `Picker` with
 * `.segmented` style), in the app's light/dark appearance. Every filter or
 * mode toggle uses it.
 */
export function NativeSegmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T
  options: ReadonlyArray<{ label: string; value: T }>
  onChange: (value: T) => void
  disabled?: boolean
}): React.ReactElement {
  const { isDark } = useTheme()
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={isDark ? 'dark' : 'light'}
    >
      <Picker
        selection={value}
        onSelectionChange={(next: T) => onChange(next)}
        modifiers={[pickerStyle('segmented'), disabledModifier(disabled)]}
      >
        {options.map((option) => (
          <Text key={option.value} modifiers={[tag(option.value)]}>
            {option.label}
          </Text>
        ))}
      </Picker>
    </Host>
  )
}
