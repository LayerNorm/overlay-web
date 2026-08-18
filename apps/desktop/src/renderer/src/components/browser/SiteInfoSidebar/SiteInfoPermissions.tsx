import { ReactElement } from 'react'
import { Shield, Trash2 } from 'lucide-react'
import { SitePermission, Theme } from '../types'

interface SiteInfoPermissionsProps {
  permissions: SitePermission[]
  theme: Theme
  onDeletePermission: (permission: string) => void
}

export function SiteInfoPermissions({
  permissions,
  theme,
  onDeletePermission
}: SiteInfoPermissionsProps): ReactElement<any> {
  return (
    <>
      <div
        style={{
          padding: '16px'
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: theme.textSecondary,
            margin: 0,
            lineHeight: 1.5
          }}
        >
          Permissions you&apos;ve granted to this site. You can revoke any permission by clicking
          the delete button.
        </p>
      </div>

      {permissions.length === 0 ? (
        <div
          style={{
            padding: 24,
            color: theme.textSecondary,
            textAlign: 'center',
            fontSize: 13
          }}
        >
          No permissions saved for this site
        </div>
      ) : (
        permissions.map((perm) => (
          <div
            key={perm.permission}
            style={{
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}
          >
            <Shield size={20} color={theme.textSecondary} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  color: theme.text,
                  textTransform: 'capitalize'
                }}
              >
                {perm.permission}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: perm.granted ? '#22c55e' : '#ef4444'
                }}
              >
                {perm.granted ? 'Allowed' : 'Denied'}
              </div>
            </div>
            <button
              onClick={() => onDeletePermission(perm.permission)}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: 'none',
                padding: '6px 12px',
                cursor: 'pointer',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: '#ef4444',
                fontSize: 12
              }}
              title="Revoke permission"
            >
              <Trash2 size={14} />
              Revoke
            </button>
          </div>
        ))
      )}
    </>
  )
}
