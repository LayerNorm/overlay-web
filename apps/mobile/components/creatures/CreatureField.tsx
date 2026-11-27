import React, { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { AgentAvatar } from '../shell/AgentAvatar'

type Spot = { shape: string; color: string; size: number; x: number; y: number; rotate: number }

/** Decorative creatures around the edges of a screen (positions in screen fractions). */
const SPOTS: Spot[] = [
  { shape: 'cloud', color: '#16a34a', size: 112, x: 0.08, y: 0.05, rotate: -6 },
  { shape: 'droplet', color: '#db2777', size: 84, x: 0.56, y: 0.06, rotate: 12 },
  { shape: 'circle', color: '#8a6240', size: 76, x: 0.86, y: 0.2, rotate: 0 },
  { shape: 'blob', color: '#7c3aed', size: 78, x: -0.05, y: 0.26, rotate: 18 },
  { shape: 'circle', color: '#dc2626', size: 92, x: 0.92, y: 0.4, rotate: -10 },
  { shape: 'squircle', color: '#f59e0b', size: 104, x: -0.08, y: 0.45, rotate: 8 },
  { shape: 'pill', color: '#14b8a6', size: 76, x: 0.88, y: 0.6, rotate: -14 },
  { shape: 'triangle', color: '#2563eb', size: 70, x: 0.12, y: 0.66, rotate: 6 },
]

export function CreatureField({ height }: { height?: number }) {
  const { isDark, theme } = useTheme()
  const window = useWindowDimensions()
  const fieldHeight = height ?? window.height
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced)
  }, [])
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {SPOTS.map((spot, index) => (
        <Drifting key={index} index={index} reduced={reduced}
          style={{ position: 'absolute', left: spot.x * window.width, top: spot.y * fieldHeight, transform: [{ rotate: `${spot.rotate}deg` }] }}>
          <AgentAvatar
            agent={{ name: '', avatarShape: spot.shape, avatarColor: spot.color }}
            dark={isDark}
            foreground={theme.foreground}
            size={spot.size}
          />
        </Drifting>
      ))}
    </View>
  )
}

/** Slow vertical bob so the field feels alive; still under Reduce Motion. */
function Drifting({ index, reduced, style, children }: {
  index: number
  reduced: boolean
  style: object
  children: React.ReactNode
}) {
  const [value] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (reduced) return
    const duration = 2600 + (index % 4) * 450
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    const timer = setTimeout(() => loop.start(), index * 220)
    return () => {
      clearTimeout(timer)
      loop.stop()
    }
  }, [index, reduced, value])
  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [0, index % 2 ? 8 : -8] })
  return <Animated.View style={[style, { transform: [...((style as { transform?: object[] }).transform ?? []), { translateY }] }]}>{children}</Animated.View>
}
