# Overlay Keyboard V2: Hybrid Mic-Overlay Redesign

## Summary
Build a two-surface voice keyboard system that feels native, minimal, and fast:
1. Phase 1 (first ship): in-app accessory mic strip for `chat` + `note` editors, replacing existing mic FAB/buttons immediately.
2. Phase 2: full custom global keyboard extension with iOS-like 3-page key layout, where the top suggestion area is replaced by a voice strip.
3. Visual direction: system-blend minimal, dynamic light/dark, iOS red for active recording, subtle motion, haptics only.
4. Interaction defaults: dual-mode mic (tap-to-toggle + press/hold), auto-insert with trailing space, inline non-blocking errors, clipboard fallback on insert failure.
5. Rollout: feature-flagged, core funnel metrics enabled, and extension deployment target corrected from iOS `26.2` to `15.1`.

## Platform Constraint (Locked)
A third-party keyboard extension cannot literally embed Apple’s system keyboard and “just add a top row.”  
Therefore:
1. In-app experience uses real iOS keyboard + accessory strip.
2. Global extension uses a custom keyboard that mimics iOS conventions, with a voice strip replacing predictions.

## UX Spec

### Design Tokens
| Token | Light | Dark |
|---|---|---|
| Background surface | `#D1D3D8` style neutral | `#1C1C1E` |
| Key surface | `#FFFFFF` | `#2C2C2E` |
| Key text | `#111111` | `#F5F5F7` |
| Secondary text | `#6B7280` | `#9CA3AF` |
| Accent (recording/waveform) | `#FF3B30` | `#FF453A` |
| Error | `#FF3B30` | `#FF453A` |
| Success | `#34C759` | `#30D158` |

Typography: SF Pro system fonts throughout keyboard surfaces.  
Motion: subtle only (100–180ms transitions, low-amplitude waveform).  
Hit targets: minimum 44x44pt.

### Voice Strip (both surfaces)
| State | Visual | Copy | Primary Action |
|---|---|---|---|
| Idle | Mic icon + calm line | “Tap or hold to dictate” | Tap starts latched recording, hold starts push-to-talk |
| Recording | Red mic, live waveform | “Listening…” | Tap stops, or release if hold-mode |
| Processing | Spinner + frozen waveform | “Transcribing…” | Disabled |
| Done | Brief check state (<=700ms) | “Inserted” | Auto returns to idle |
| Error | Inline red rail | Specific error + “Retry” affordance | Retry recording/transcription |

Press/hold threshold: 180ms.  
Quick punctuation chips (always visible): `. , ? ! '`

### Phase 1: In-App Accessory Strip
Target screens:
1. `app/chat/[id].tsx`
2. `app/note/[id].tsx`

Behavior:
1. Use iOS `InputAccessoryView` strip attached to active text input.
2. Remove legacy in-screen mic controls immediately:
   - remove chat composer mic button state flow.
   - remove note FAB mic + floating status pill.
3. Keep native system keyboard untouched; strip provides voice control and punctuation shortcuts.
4. Inline rail in strip handles API-key missing, mic denied, transcription failure.
5. First-run coachmark: 3-step guided overlay (“Tap mic”, “Hold to dictate”, “Auto insert”).

### Phase 2: Global Extension UI
Layout:
1. Top voice strip replaces suggestion band.
2. Full iOS-like keyboard deck below (3 pages: `ABC`, `123`, `#+=`).
3. Required utility keys: delete, return, space, globe/input-mode switch, page switch keys.
4. Return key label follows context (`return`, `send`, `done`, etc.) via `textDocumentProxy.returnKeyType`.
5. Keep quick punctuation shortcuts always accessible while on `ABC`.

Key pages:
1. `ABC`: qwerty rows + shift/delete + bottom utility row.
2. `123`: digits + symbol rows + delete + utility row.
3. `#+=`: extended symbols + delete + utility row.

Error handling:
1. Inline rail only, never blocking modal.
2. On insertion failure after retries: copy transcript to clipboard + inline “Copied, tap to paste”.

## Technical Implementation Plan

### 1) Foundation and Config
1. Fix extension deployment target to `15.1` in `ios/Overlay.xcodeproj/project.pbxproj`.
2. Add feature flags in shared storage:
   - `voice_accessory_v1_enabled`
   - `overlay_keyboard_v2_enabled`
3. Introduce shared keyboard token definitions in Swift and TS (matching semantic names).

### 2) In-App Accessory (Phase 1)
1. Add `components/voice/DictationAccessoryStrip.tsx` (RN).
2. Add insertion helper utilities for punctuation and cursor-safe transcript insertion.
3. Integrate strip into `app/chat/[id].tsx` and `app/note/[id].tsx`.
4. Update `hooks/useVoiceInput.ts` to support dual-mode semantics and unified status callbacks.
5. Remove current mic UI controls from chat and note surfaces.

### 3) Extension Redesign (Phase 2)
1. Replace current `RecordingView` panel in `ios/OverlayKeyboard/KeyboardView.swift` with:
   - `VoiceStripView`
   - `KeyboardDeckView`
   - `ErrorRailView`
2. Add keyboard engine types:
   - `KeyboardPage` (`abc`, `numeric`, `symbols`)
   - `ShiftState` (`lower`, `upper`, `capsLock`)
   - `KeyAction` (`character`, `backspace`, `space`, `return`, `switchPage`, `shift`, `globe`, `dictationToggle`)
3. Update `KeyboardViewController.swift` to expose `needsInputModeSwitchKey`, return-key behavior, and insertion hooks to SwiftUI.
4. Keep existing `TranscriptionService.swift` architecture but add:
   - explicit event emissions for metrics.
   - light cleanup function before insert.
   - trailing-space policy.
5. Implement coachmark flow in extension local state (`shown once`, resettable from settings later).

### 4) Metrics and Observability
Track core funnel events on both surfaces:
1. `dictation_start`
2. `dictation_stop`
3. `transcription_success`
4. `transcription_failure`
5. `insertion_success`
6. `insertion_failure_clipboard`

Required properties:
1. `surface` (`in_app_chat`, `in_app_note`, `extension`)
2. `latency_ms_record_to_text`
3. `chars_inserted`
4. `mode` (`tap_toggle`, `hold`)
5. `background_mode_enabled`

## Public API / Interface / Type Changes

### React Native
1. Add `DictationAccessoryStripProps`:
   - `state`
   - `audioLevel`
   - `errorMessage`
   - `onMicTap`
   - `onMicHoldStart`
   - `onMicHoldEnd`
   - `onInsertPunctuation`
   - `onDelete`
   - `onReturn`

2. Add reusable transcript insertion helper interface:
   - input: `currentText`, `cursorStart`, `cursorEnd`, `transcript`
   - output: `nextText`, `nextCursor`

### iOS Extension (Swift)
1. Add keyboard engine models:
   - `KeyboardPage`
   - `ShiftState`
   - `KeyAction`
   - `KeyboardKeyModel`
2. Extend transcription pipeline contract:
   - `normalizeTranscript(_:)`
   - `applyTrailingSpaceRule(_:, contextAfter:)`
3. Add metrics emitter interface for keyboard events.

## Testing and Acceptance Scenarios

### Unit Tests
1. Transcript cleanup and trailing-space rule.
2. Key engine transitions: page switching, shift/caps behavior, return action mapping.
3. Quick punctuation insertion logic with selections/cursor positions.
4. Retry + clipboard fallback behavior.

### Integration Tests
1. Start/stop dictation inserts text in active field on chat and note.
2. Hold-to-talk path inserts on release.
3. Background-first flow: inline start when enabled, graceful fallback when unavailable.
4. Extension insertion in multiple host app contexts.

### UI/Manual QA Matrix
1. Light and dark mode on iOS 15/16/17+ devices.
2. Portrait and compact-height contexts.
3. VoiceOver label/readout for all mic and key controls.
4. Dynamic Type scaling without clipped controls.
5. Full-access denied state and API-key-missing state.
6. Network loss during processing.
7. Secure field and unsupported-input contexts.

### Performance Targets
1. Mic tap to visible recording state: <=120ms.
2. Stop to “processing” transition: <=100ms.
3. Insertion success rate: >=99% with clipboard fallback covering remainder.
4. No dropped keypresses during active waveform animation.

## Rollout Plan
1. Ship Phase 1 behind `voice_accessory_v1_enabled`; default on for internal builds.
2. Remove old in-app mic UI in same release branch (no dual path).
3. Validate metrics and QA pass, then enable for all users.
4. Implement Phase 2 extension behind `overlay_keyboard_v2_enabled`.
5. Keep legacy extension UI as rollback path until extension V2 meets funnel thresholds.

## Assumptions and Defaults (Explicit)
1. Hybrid strategy is required and accepted.
2. Shipping order is in-app first, then global extension.
3. Full extension keyboard clone is required (3 pages).
4. Suggestion area is replaced by voice strip only.
5. Dictation language is auto-detect only in v1 (no picker).
6. Background mode control remains in keyboard and app surfaces.
7. Mic interaction is dual-mode (tap toggle + hold).
8. Feedback is haptics only.
9. Errors are inline and non-blocking.
10. First-run extension onboarding is a step-by-step coachmark.
11. Deployment target mismatch (`26.2`) will be corrected to `15.1`.
