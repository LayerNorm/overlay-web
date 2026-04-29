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
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 340)
const CONTENT_PUSH = DRAWER_WIDTH
const EDGE_SWIPE_THRESHOLD = 32

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

  const animate = useCallback(
    (toOpen: boolean) => {
      if (toOpen) {
        Animated.parallel([
          Animated.spring(drawerTranslateX, {
            toValue: 0,
            tension: 85,
            friction: 18,
            useNativeDriver: true,
          }),
          Animated.spring(contentTranslateX, {
            toValue: CONTENT_PUSH,
            tension: 85,
            friction: 18,
            useNativeDriver: true,
          }),
          Animated.timing(scrimOpacity, {
            toValue: 0.25,
            duration: 250,
            useNativeDriver: true,
          }),
        ]).start()
      } else {
        Animated.parallel([
          Animated.spring(drawerTranslateX, {
            toValue: -DRAWER_WIDTH,
            tension: 100,
            friction: 20,
            useNativeDriver: true,
          }),
          Animated.spring(contentTranslateX, {
            toValue: 0,
            tension: 100,
            friction: 20,
            useNativeDriver: true,
          }),
          Animated.timing(scrimOpacity, {
            toValue: 0,
            duration: 200,
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

  // Edge swipe gesture to open drawer
  const edgePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => {
        // Only respond to rightward swipes starting from left edge
        return !drawerVisible && gs.moveX < EDGE_SWIPE_THRESHOLD && gs.dx > 8
      },
      onPanResponderGrant: () => {
        // no-op
      },
      onPanResponderMove: (_, gs) => {
        const progress = Math.min(1, Math.max(0, gs.dx / DRAWER_WIDTH))
        const drawerX = -DRAWER_WIDTH + (progress * DRAWER_WIDTH)
        const contentX = progress * CONTENT_PUSH
        drawerTranslateX.setValue(drawerX)
        contentTranslateX.setValue(contentX)
        scrimOpacity.setValue(progress * 0.25)
      },
      onPanResponderRelease: (_, gs) => {
        const progress = gs.dx / DRAWER_WIDTH
        if (progress > 0.3 || gs.vx > 0.5) {
          openDrawer()
        } else {
          // Snap back closed
          Animated.parallel([
            Animated.spring(drawerTranslateX, {
              toValue: -DRAWER_WIDTH,
              tension: 100,
              friction: 20,
              useNativeDriver: true,
            }),
            Animated.spring(contentTranslateX, {
              toValue: 0,
              tension: 100,
              friction: 20,
              useNativeDriver: true,
            }),
            Animated.timing(scrimOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start()
        }
      },
    }),
  ).current

  return (
    <View style={styles.container}>
      {/* Edge swipe detection area */}
      {/* Always render edge swipe area for better responsiveness */}
      {!drawerVisible && (
        <View
          style={styles.edgeSwipeArea}
          {...edgePanResponder.panHandlers}
        />
      )}
      <Animated.View style={[styles.content, { transform: [{ translateX: contentTranslateX }] }]}>
        {children}
      </Animated.View>

      {/* Always render drawer off-screen to eliminate flicker */}
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
  edgeSwipeArea: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_SWIPE_THRESHOLD,
    zIndex: 10,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 10, height: 0 },
    elevation: 20,
    overflow: 'hidden',
  },
})
