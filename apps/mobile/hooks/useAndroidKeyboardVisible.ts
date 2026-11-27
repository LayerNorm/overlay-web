import { useEffect, useReducer } from 'react'
import { Keyboard, Platform } from 'react-native'
import { keyboardVisibilityReducer } from '../lib/keyboardLayout'

export function useAndroidKeyboardVisible(): boolean {
  const [visible, dispatch] = useReducer(
    keyboardVisibilityReducer,
    Platform.OS === 'android' && Keyboard.isVisible(),
  )

  useEffect(() => {
    if (Platform.OS !== 'android') return

    const show = Keyboard.addListener('keyboardDidShow', () => dispatch('show'))
    const hide = Keyboard.addListener('keyboardDidHide', () => dispatch('hide'))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  return Platform.OS === 'android' && visible
}
