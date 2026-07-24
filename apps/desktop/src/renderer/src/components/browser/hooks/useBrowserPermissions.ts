import { useState, useEffect, useCallback } from 'react'
import { PermissionRequest, PermissionType } from '../PermissionPrompt'
import { PERMISSION_BAR_HEIGHT } from '../PermissionPrompt'

interface UseBrowserPermissionsReturn {
  permissionRequest: PermissionRequest | null
  setPermissionRequest: React.Dispatch<React.SetStateAction<PermissionRequest | null>>
  handleAllowPermission: (id: string, remember: boolean) => void
  handleDenyPermission: (id: string, remember: boolean) => void
}

export function useBrowserPermissions(): UseBrowserPermissionsReturn {
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)

  // Base bottom bar is 56px (set in BrowserPanel), only add extra height for permission bar
  useEffect(() => {
    const bottomBarHeight = 56 + (permissionRequest ? PERMISSION_BAR_HEIGHT : 0)
    window.bridge.browser.setBottomBarHeight(bottomBarHeight)
  }, [permissionRequest])

  useEffect(() => {
    const unsub = window.bridge.browser.onPermissionRequest((request) => {
      setPermissionRequest(request as PermissionRequest)
    })
    return () => unsub()
  }, [])

  const handleAllowPermission = useCallback(
    (id: string, remember: boolean): void => {
      if (permissionRequest) {
        window.bridge.browser.resolvePermission(
          id,
          true,
          remember,
          permissionRequest.origin,
          permissionRequest.permission as PermissionType
        )
        setPermissionRequest(null)
      }
    },
    [permissionRequest]
  )

  const handleDenyPermission = useCallback(
    (id: string, remember: boolean): void => {
      if (permissionRequest) {
        window.bridge.browser.resolvePermission(
          id,
          false,
          remember,
          permissionRequest.origin,
          permissionRequest.permission as PermissionType
        )
        setPermissionRequest(null)
      }
    },
    [permissionRequest]
  )

  return {
    permissionRequest,
    setPermissionRequest,
    handleAllowPermission,
    handleDenyPermission
  }
}
