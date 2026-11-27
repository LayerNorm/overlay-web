import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { agentEyePosition } from '../lib/agentEyes'

export function useAgentEyes(working: boolean, reducedMotion?: boolean) {
  const [systemReduced, setReduced] = useState(true)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    )
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  const enabled = working && !(reducedMotion ?? systemReduced)
  useEffect(() => {
    if (!enabled) return
    const started = Date.now()
    const timer = setInterval(() => {
      setPosition({ x: agentEyePosition(Date.now() - started), y: 0 })
    }, 50)
    return () => clearInterval(timer)
  }, [enabled])
  return enabled ? position : { x: 0, y: 0 }
}
