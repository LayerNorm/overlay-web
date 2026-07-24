import { describe, expect, it } from 'vitest'
import {
  canSubmitDesktopMediaDraft,
  reconcileMediaModelSelection,
  toggleMediaModelSelection
} from './useDesktopMediaComposerState'

describe('desktop media composer model selection', () => {
  it('uses replacement semantics in single mode', () => {
    expect(toggleMediaModelSelection(['image-a'], 'image-b', 'single')).toEqual(['image-b'])
  })

  it('keeps at least one model and caps multiple mode at four', () => {
    expect(toggleMediaModelSelection(['a'], 'a', 'multiple')).toEqual(['a'])
    expect(toggleMediaModelSelection(['a', 'b'], 'a', 'multiple')).toEqual(['b'])
    expect(toggleMediaModelSelection(['a', 'b', 'c', 'd'], 'e', 'multiple')).toEqual([
      'a',
      'b',
      'c',
      'd'
    ])
  })

  it('reconciles saved IDs against runtime bootstrap catalogs', () => {
    expect(
      reconcileMediaModelSelection(
        ['removed', 'image-b'],
        ['image-a', 'image-b'],
        'image-a',
        'multiple'
      )
    ).toEqual(['image-b'])
    expect(reconcileMediaModelSelection([], ['image-a'], 'missing', 'single')).toEqual(['image-a'])
    expect(reconcileMediaModelSelection(['a', 'b'], ['a', 'b'], undefined, 'single')).toEqual(['a'])
  })

  it('uses the same submission requirements for buttons and keyboard input', () => {
    const candidate = {
      generationMode: 'video' as const,
      prompt: 'Animate this',
      attachmentCount: 0,
      selectedImageModelIds: [],
      selectedVideoModelIds: ['video-a'],
      videoSubMode: 'image-to-video' as const
    }

    expect(canSubmitDesktopMediaDraft(candidate)).toBe(false)
    expect(canSubmitDesktopMediaDraft({ ...candidate, attachmentCount: 1 })).toBe(true)
    expect(
      canSubmitDesktopMediaDraft({
        ...candidate,
        generationMode: 'image',
        selectedImageModelIds: ['image-a'],
        prompt: 'Draw this'
      })
    ).toBe(true)
    expect(
      canSubmitDesktopMediaDraft({
        ...candidate,
        generationMode: 'text',
        prompt: '',
        attachmentCount: 1
      })
    ).toBe(true)
  })
})
