import React, { useRef } from 'react'
import { Pressable, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import Animated, { useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { useTheme } from '../../hooks/useTheme'
import { hapticImpact } from '../../lib/haptics'
import { T } from '../shell/primitives'

export type SwipeAction = {
  label: string
  /** SF Symbol name. */
  icon: string
  destructive?: boolean
  /**
   * Run as soon as a short swipe opens the row, for a harmless, easily undone
   * action such as Mark as Read. Otherwise a short swipe only reveals the
   * button and a full swipe runs it.
   */
  runOnOpen?: boolean
  onPress: () => void
}

const ACTION_WIDTH = 80
const RED = { light: '#ff3b30', dark: '#ff453a' }

/**
 * A list row with iOS-style swipe actions, like Mail. Swipe a little to
 * reveal the buttons, or all the way to run the first action on that side
 * (it stretches to fill the row and gives a haptic tap when the swipe
 * crosses the point of no return). An action marked `runOnOpen` runs as soon
 * as a short swipe opens the row. The first action sits at the outer edge.
 */
export function SwipeRow({
  leading = [],
  trailing = [],
  children,
}: {
  /** Revealed by swiping right. */
  leading?: SwipeAction[]
  /** Revealed by swiping left. */
  trailing?: SwipeAction[]
  children: React.ReactNode
}) {
  const { theme } = useTheme()
  const { width } = useWindowDimensions()
  const swipe = useRef<SwipeableMethods>(null)
  const translation = useRef<SharedValue<number> | null>(null)
  const full = width * 0.55
  if (!leading.length && !trailing.length) return <>{children}</>

  const run = (action: SwipeAction) => {
    swipe.current?.close()
    action.onPress()
  }
  const panel = (side: 'leading' | 'trailing', actions: SwipeAction[]) =>
    actions.length
      ? (_progress: SharedValue<number>, value: SharedValue<number>) => {
          translation.current = value
          return <Panel side={side} actions={actions} translation={value} full={full} onAction={run} />
        }
      : undefined

  return (
    <GestureHandlerRootView style={{ flex: 0 }}>
      <ReanimatedSwipeable
        ref={swipe}
        friction={1}
        overshootFriction={1}
        overshootLeft={leading.length > 0}
        overshootRight={trailing.length > 0}
        leftThreshold={48}
        rightThreshold={48}
        renderLeftActions={panel('leading', leading)}
        renderRightActions={panel('trailing', trailing)}
        // 'right' is the swipe direction that opens the leading actions.
        onSwipeableWillOpen={(direction) => {
          const actions = direction === 'right' ? leading : trailing
          const distance = Math.abs(translation.current?.value ?? 0)
          if (actions[0]?.runOnOpen || distance >= full) {
            hapticImpact()
            run(actions[0])
          }
        }}
      >
        <View style={{ backgroundColor: theme.background }}>{children}</View>
      </ReanimatedSwipeable>
    </GestureHandlerRootView>
  )
}

function Panel({
  side,
  actions,
  translation,
  full,
  onAction,
}: {
  side: 'leading' | 'trailing'
  actions: SwipeAction[]
  translation: SharedValue<number>
  full: number
  onAction: (action: SwipeAction) => void
}) {
  const { theme, isDark } = useTheme()
  const base = actions.length * ACTION_WIDTH
  const style = useAnimatedStyle(() => ({ width: Math.max(base, Math.abs(translation.value)) }))
  useAnimatedReaction(
    () => Math.abs(translation.value) >= full,
    (past, before) => {
      if (!actions[0]?.runOnOpen && before !== null && past !== before) scheduleOnRN(hapticImpact)
    },
  )
  return (
    <Animated.View style={[{ flexDirection: side === 'leading' ? 'row' : 'row-reverse' }, style]}>
      {actions.map((action, index) => {
        const background = action.destructive ? (isDark ? RED.dark : RED.light) : (theme.foreground as string)
        const foreground = action.destructive ? '#ffffff' : (theme.background as string)
        return (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => onAction(action)}
            style={{
              ...(index === 0 ? { flex: 1 } : { width: ACTION_WIDTH }),
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              backgroundColor: background,
            }}
          >
            <Image source={'sf:' + action.icon} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={foreground} />
            <T style={{ color: foreground, fontSize: 12, fontWeight: '600' }}>{action.label}</T>
          </Pressable>
        )
      })}
    </Animated.View>
  )
}
