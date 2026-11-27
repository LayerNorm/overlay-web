import { describe, expect, it } from 'vitest'
import {
  migrateMessagesToV3,
  normalizeStoredConversation,
} from '../src/background/runtime'
import { normalizeExtensionPreferencesModelFields } from '../src/background/storage'
import type { ConversationMessage } from '@overlay/extension-contracts'

function userMsg(id: string): ConversationMessage {
  return { id, role: 'user', parts: [{ type: 'text', id: `${id}-t`, text: 'hi' }], createdAt: 1 }
}
function assistantMsg(id: string): ConversationMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', id: `${id}-t`, text: 'hello' }], createdAt: 2 }
}

describe('migrateMessagesToV3', () => {
  it('no-ops when every message already has a turnId', () => {
    const messages: ConversationMessage[] = [
      { ...userMsg('u1'), turnId: 'T1' },
      { ...assistantMsg('a1'), turnId: 'T1', variantIndex: 0 },
    ]
    expect(migrateMessagesToV3(messages)).toBe(messages)
  })

  it('groups assistants after each user message into a shared turn', () => {
    const migrated = migrateMessagesToV3([
      userMsg('u1'),
      assistantMsg('a1'),
      userMsg('u2'),
      assistantMsg('a2'),
      assistantMsg('a3'),
    ])
    expect(migrated.map((m) => m.turnId)).toEqual([
      'legacy-u1', 'legacy-u1',
      'legacy-u2', 'legacy-u2', 'legacy-u2',
    ])
  })

  it('falls back to the assistant id when no user precedes', () => {
    const migrated = migrateMessagesToV3([assistantMsg('a1'), userMsg('u1'), assistantMsg('a2')])
    expect(migrated[0]!.turnId).toBe('legacy-a1')
    expect(migrated[1]!.turnId).toBe('legacy-u1')
    expect(migrated[2]!.turnId).toBe('legacy-u1')
  })
})

describe('normalizeStoredConversation v2 → v3', () => {
  it('upgrades version from 2 to 3 and synthesizes turnIds', () => {
    const raw = {
      id: 'c1',
      title: 'Legacy Chat',
      preview: '',
      updatedAt: 111,
      version: 2,
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', id: 'pt', text: 'hi' }], createdAt: 1 },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', id: 'pt2', text: 'hello' }], createdAt: 2 },
      ],
    }
    const normalized = normalizeStoredConversation(raw)
    expect(normalized).not.toBeNull()
    expect(normalized!.version).toBe(3)
    expect(normalized!.messages[0]!.turnId).toBe('legacy-u1')
    expect(normalized!.messages[1]!.turnId).toBe('legacy-u1')
  })

  it('rejects malformed input', () => {
    expect(normalizeStoredConversation(null)).toBeNull()
    expect(normalizeStoredConversation('nope')).toBeNull()
  })

  it('preserves v3-only fields (browserScope, actApprovalMode, actAllowlist)', () => {
    const raw = {
      id: 'c2',
      title: 'Modern',
      preview: 'p',
      updatedAt: 222,
      version: 3,
      messages: [
        { id: 'u1', role: 'user', parts: [], createdAt: 1, turnId: 'T1' },
      ],
      browserScope: 'current-window',
      actApprovalMode: 'auto',
      actAllowlist: ['click'],
    }
    const normalized = normalizeStoredConversation(raw)!
    expect(normalized.browserScope).toBe('current-window')
    expect(normalized.actApprovalMode).toBe('auto')
    expect(normalized.actAllowlist).toEqual(['click'])
  })

  it('drops unknown enum values for scope / approval mode', () => {
    const raw = {
      id: 'c3',
      title: 't',
      preview: '',
      updatedAt: 1,
      messages: [],
      browserScope: 'galaxy-brain',
      actApprovalMode: 'maybe',
    }
    const normalized = normalizeStoredConversation(raw)!
    expect(normalized.browserScope).toBeUndefined()
    expect(normalized.actApprovalMode).toBeUndefined()
  })
})

describe('normalizeExtensionPreferencesModelFields', () => {
  it('prefers modelId over legacy askModelId and actModelId', () => {
    const next = normalizeExtensionPreferencesModelFields({
      baseUrl: 'https://getoverlay.io',
      modelId: 'gpt-5.4',
      askModelId: 'claude-haiku-4-5',
      actModelId: 'gemini-3-flash-preview',
    })
    expect(next.modelId).toBe('gpt-5.4')
    expect((next as { askModelId?: string }).askModelId).toBeUndefined()
    expect((next as { actModelId?: string }).actModelId).toBeUndefined()
  })

  it('falls back askModelId then actModelId', () => {
    expect(
      normalizeExtensionPreferencesModelFields({
        baseUrl: 'https://getoverlay.io',
        modelId: '   ',
        askModelId: 'gpt-5.4',
        actModelId: 'claude-haiku-4-5',
      }).modelId,
    ).toBe('gpt-5.4')

    expect(
      normalizeExtensionPreferencesModelFields({
        baseUrl: 'https://getoverlay.io',
        modelId: '   ',
        actModelId: 'claude-haiku-4-5',
      }).modelId,
    ).toBe('claude-haiku-4-5')
  })
})
