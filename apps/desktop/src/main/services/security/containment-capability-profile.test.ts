import { describe, expect, it } from 'vitest'
import {
  applyContainmentToolProfile,
  areChatAgentLocalCapabilitiesEnabled,
  areUnsafeLocalCapabilitiesEnabled,
  isToolDeniedByContainmentProfile
} from './containment-capability-profile'

describe('Phase 0 containment capability profile', () => {
  it('cannot be enabled in packaged builds through an environment variable', () => {
    expect(
      areUnsafeLocalCapabilitiesEnabled(true, {
        OVERLAY_ENABLE_UNSAFE_LOCAL_CAPABILITIES: '1'
      })
    ).toBe(false)
  })

  it('requires explicit opt-in in development builds', () => {
    expect(areUnsafeLocalCapabilitiesEnabled(false, {})).toBe(false)
    expect(
      areUnsafeLocalCapabilitiesEnabled(false, {
        OVERLAY_ENABLE_UNSAFE_LOCAL_CAPABILITIES: '1'
      })
    ).toBe(true)
  })

  it('enables unsandboxed local tools only for permissioned desktop chat', () => {
    expect(areChatAgentLocalCapabilitiesEnabled('chat', 'ask_for_approval', true, {})).toBe(true)
    expect(areChatAgentLocalCapabilitiesEnabled('chat', 'full_access', true, {})).toBe(true)
    expect(areChatAgentLocalCapabilitiesEnabled('browser', 'full_access', true, {})).toBe(false)
    expect(areChatAgentLocalCapabilitiesEnabled('voice', 'full_access', true, {})).toBe(false)
  })

  it.each([
    'terminal_run',
    'script_run',
    'install_packages',
    'fs_write_file',
    'applescript_run',
    'COMPOSIO_REMOTE_BASH_TOOL',
    'browser_click',
    'headless_navigate',
    'download_file',
    'code_git_commit'
  ])('denies high-risk tool %s', (toolName) => {
    expect(isToolDeniedByContainmentProfile(toolName)).toBe(true)
  })

  it('retains non-side-effecting local tools', () => {
    const tools = {
      get_current_time: {},
      overlay_notes_search: {},
      terminal_run: {},
      browser_click: {},
      COMPOSIO_REMOTE_WORKBENCH: {}
    }

    expect(applyContainmentToolProfile(tools)).toEqual({
      get_current_time: {},
      overlay_notes_search: {}
    })
  })
})
