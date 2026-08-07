import type { AuthorizationCapability } from '@overlay/authz-contracts'

export type AuthorizationEnforcementMode = 'enforce' | 'observe'

export interface AppAuthorizationState {
  capabilities: readonly AuthorizationCapability[]
  enforcementMode: AuthorizationEnforcementMode
  isDeploymentOwner: boolean
}
