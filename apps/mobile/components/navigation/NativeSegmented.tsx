import React from 'react'
import { Host, Picker, Text } from '@expo/ui/swift-ui'
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers'
import { useTheme } from '../../hooks/useTheme'

/** The system segmented control (SwiftUI `Picker` with `.segmented` style). */
export function NativeSegmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: ReadonlyArray<{ label: string; value: T }>
  onChange: (value: T) => void
}): React.ReactElement {
  const { isDark } = useTheme()
  return (
    <Host matchContents={{ vertical: true }} colorScheme={isDark ? 'dark' : 'light'} style={{ marginHorizontal: 16 }}>
      <Picker
        selection={value}
        onSelectionChange={(next: T) => onChange(next)}
        modifiers={[pickerStyle('segmented')]}
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
