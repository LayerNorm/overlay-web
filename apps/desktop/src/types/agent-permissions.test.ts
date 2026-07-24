import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_TOOL_PERMISSION_MODE,
  isChatToolPermissionMode,
  normalizeChatToolPermissionMode
} from './agent-permissions'

describe('desktop chat tool permission mode', () => {
  it('defaults missing, invalid, and legacy values to approval mode', () => {
    expect(normalizeChatToolPermissionMode(undefined)).toBe(DEFAULT_CHAT_TOOL_PERMISSION_MODE)
    expect(normalizeChatToolPermissionMode('allow')).toBe('ask_for_approval')
    expect(normalizeChatToolPermissionMode('unrestricted')).toBe('ask_for_approval')
    expect(normalizeChatToolPermissionMode({ mode: 'full_access' })).toBe('ask_for_approval')
  })

  it('accepts only the two supported desktop modes', () => {
    expect(isChatToolPermissionMode('ask_for_approval')).toBe(true)
    expect(isChatToolPermissionMode('full_access')).toBe(true)
    expect(isChatToolPermissionMode('approve_for_me')).toBe(false)
  })
})
