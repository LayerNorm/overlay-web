import React, { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  View,
} from 'react-native'
import { useDrawer } from '../../contexts/DrawerContext'

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 320)
const CONTENT_PUSH = DRAWER_WIDTH * 0.85

export function ScreenWithDrawer({
  children,
  drawer,
}: {
  children: React.ReactNode
  drawer: React.ReactNode
}): React.ReactElement {
  const { drawerVisible, closeDrawer } = useDrawer()
  const contentTranslateX = useRef(new Animated.Value(0)).current
  const drawerTranslateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current
  const scrimOpacity = useRef(new Animated.Value(0)).current
  const [shouldRenderDrawer, setShouldRenderDrawer] = useState(drawerVisible)

  useEffect(() => {
    if (drawerVisible) {
      setShouldRenderDrawer(true)
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
      ]).start(() => {
        setShouldRenderDrawer(false)
      })
    }
  }, [drawerVisible, contentTranslateX, drawerTranslateX, scrimOpacity])

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { transform: [{ translateX: contentTranslateX }] }]}>
        {children}
      </Animated.View>

      {shouldRenderDrawer && (
        <>
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
        </>
      )}
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
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 10, height: 0 },
    elevation: 20,
    overflow: 'hidden',
  },
})
