import React, { useCallback, useEffect, useRef } from 'react'
import {
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { useDrawer } from '../../contexts/DrawerContext'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
export const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320)
const CONTENT_PUSH = DRAWER_WIDTH
const EDGE_SWIPE_START = 30

export function ScreenWithDrawer({
  children,
  drawer,
}: {
  children: React.ReactNode
  drawer: React.ReactNode
}): React.ReactElement {
  const { drawerVisible, closeDrawer, openDrawer } = useDrawer()
  const contentTranslateX = useRef(new Animated.Value(0)).current
  const drawerTranslateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current
  const scrimOpacity = useRef(new Animated.Value(0)).current

  // Keep a ref so PanResponder closures always see current value
  const drawerVisibleRef = useRef(drawerVisible)
  useEffect(() => {
    drawerVisibleRef.current = drawerVisible
  }, [drawerVisible])

  const animate = useCallback(
    (toOpen: boolean) => {
      if (toOpen) {
        Animated.parallel([
          Animated.spring(drawerTranslateX, {
            toValue: 0,
            tension: 65,
            friction: 14,
            useNativeDriver: true,
          }),
          Animated.spring(contentTranslateX, {
            toValue: CONTENT_PUSH,
            tension: 65,
            friction: 14,
            useNativeDriver: true,
          }),
          Animated.timing(scrimOpacity, {
            toValue: 0.25,
            duration: 220,
            useNativeDriver: true,
          }),
        ]).start()
      } else {
        Animated.parallel([
          Animated.spring(drawerTranslateX, {
            toValue: -DRAWER_WIDTH,
            tension: 80,
            friction: 16,
            useNativeDriver: true,
          }),
          Animated.spring(contentTranslateX, {
            toValue: 0,
            tension: 80,
            friction: 16,
            useNativeDriver: true,
          }),
          Animated.timing(scrimOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start()
      }
    },
    [drawerTranslateX, contentTranslateX, scrimOpacity],
  )

  useEffect(() => {
    animate(drawerVisible)
  }, [drawerVisible, animate])

  // Edge-swipe PanResponder on the container — uses onMoveShouldSetPanResponder so
  // it never blocks taps (buttons, inputs etc). Only claimed when the finger started
  // within EDGE_SWIPE_START px of the left edge and is moving rightward.
  const edgePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        if (drawerVisibleRef.current) return false
        return gs.x0 < EDGE_SWIPE_START && gs.dx > 12 && gs.dx > Math.abs(gs.dy) * 1.2
      },
      onPanResponderGrant: () => {},
      onPanResponderMove: (_, gs) => {
        const progress = Math.min(1, Math.max(0, gs.dx / DRAWER_WIDTH))
        drawerTranslateX.setValue(-DRAWER_WIDTH + progress * DRAWER_WIDTH)
        contentTranslateX.setValue(progress * CONTENT_PUSH)
        scrimOpacity.setValue(progress * 0.25)
      },
      onPanResponderRelease: (_, gs) => {
        const progress = gs.dx / DRAWER_WIDTH
        if (progress > 0.3 || gs.vx > 0.5) {
          openDrawer()
        } else {
          Animated.parallel([
            Animated.spring(drawerTranslateX, {
              toValue: -DRAWER_WIDTH,
              tension: 80,
              friction: 16,
              useNativeDriver: true,
            }),
            Animated.spring(contentTranslateX, {
              toValue: 0,
              tension: 80,
              friction: 16,
              useNativeDriver: true,
            }),
            Animated.timing(scrimOpacity, {
              toValue: 0,
              duration: 180,
              useNativeDriver: true,
            }),
          ]).start()
        }
      },
    }),
  ).current

  return (
    <View style={styles.container} {...edgePanResponder.panHandlers}>
      <Animated.View style={[styles.content, { transform: [{ translateX: contentTranslateX }] }]}>
        {children}
      </Animated.View>

      <Animated.View
        style={[StyleSheet.absoluteFillObject, styles.scrim, { opacity: scrimOpacity }]}
        pointerEvents={drawerVisible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          {
            width: DRAWER_WIDTH,
            transform: [{ translateX: drawerTranslateX }],
          },
        ]}
      >
        {drawer}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  scrim: {
    backgroundColor: '#000',
    zIndex: 1,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 2,
    overflow: 'hidden',
  },
})
