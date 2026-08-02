'use client'

import type { AppAuthorizationState } from '@overlay/app-core'
import type { AuthorizationCapability } from '@overlay/authz-contracts'
import { createContext, useContext, useMemo } from 'react'
import {
  allowsClientRequirement,
  satisfiesAuthorizationRequirement,
  type ClientAuthorizationRequirement,
} from '@/shared/authorization/client-policy'

type AuthorizationContextValue = {
  authorization: AppAuthorizationState | null
  allows(requirement: ClientAuthorizationRequirement | null): boolean
  can(capability: AuthorizationCapability): boolean
  canAny(capabilities: readonly AuthorizationCapability[]): boolean
}

const AuthorizationContext = createContext<AuthorizationContextValue | null>(null)

export function AuthorizationProvider({
  authorization,
  children,
}: {
  authorization: AppAuthorizationState | null
  children: React.ReactNode
}) {
  const value = useMemo<AuthorizationContextValue>(() => ({
    authorization,
    allows: (requirement) => authorization
      ? allowsClientRequirement(authorization, requirement)
      : true,
    can: (capability) => authorization
      ? satisfiesAuthorizationRequirement(authorization, { all: [capability] })
      : false,
    canAny: (capabilities) => authorization
      ? satisfiesAuthorizationRequirement(authorization, { any: capabilities })
      : false,
  }), [authorization])

  return (
    <AuthorizationContext.Provider value={value}>
      {children}
    </AuthorizationContext.Provider>
  )
}

export function useAuthorization(): AuthorizationContextValue {
  return useContext(AuthorizationContext) ?? {
    authorization: null,
    allows: () => true,
    can: () => false,
    canAny: () => false,
  }
}
