import React from 'react'
import { ScrollView } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { CreatureEmpty } from '../creatures/CreatureEmpty'

/**
 * Turned-off or unavailable feature. Renders under the screen's native
 * navigation bar, so a server-side flag flip reads as "feature off", not a
 * broken screen.
 */
export function FeatureGate({
  title,
  description = 'This feature is turned off for your account.',
}: {
  title: string
  description?: string
}): React.ReactElement {
  const { theme } = useTheme()
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <CreatureEmpty title={title} detail={description} shape="squircle" color="#94a3b8" />
    </ScrollView>
  )
}
