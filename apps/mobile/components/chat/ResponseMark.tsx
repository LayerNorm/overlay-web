import React from 'react'
import { View } from 'react-native'
import { OverlayMark } from '../shell/Brand'
import { useAgentEyes } from '../../hooks/useAgentEyes'

export function ResponseMark({ color }: { color: string }) {
  const eyes = useAgentEyes(true)
  return <View accessible accessibilityLabel="Response in progress" accessibilityRole="image" style={{ marginVertical: 16, width: 24, height: 24 }}><OverlayMark size={24} color={color} eyeX={eyes.x} eyeY={eyes.y} /></View>
}
