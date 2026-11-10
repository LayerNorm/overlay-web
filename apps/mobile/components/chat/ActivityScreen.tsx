import React from 'react'
import { FeatureGate } from '../ui/FeatureGate'

export function ActivityScreen(): React.ReactElement {
  // Convex-native in Phase 1
  return <FeatureGate title="Activity is coming in Phase 1" description="Notifications return with native subscriptions." />
}
