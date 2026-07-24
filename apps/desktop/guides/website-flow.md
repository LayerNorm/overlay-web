# Overlay Website Flow & Content Strategy

## App Theme

**Overlay** is a macOS application that reimagines personal computing through an **"overlay-first"** paradigm. The core philosophy centers on:

> *"Move execution to where intent first appears, using overlays."*

The app eliminates context switching by providing instant-access overlays for voice, notes, chat, and browsing—all available through simple keyboard shortcuts without leaving the current task.

---

## Website Flow Overview

The landing page uses a **scroll-driven narrative** with 11 sequential sections. Each section is fixed-position with opacity transitions tied to scroll progress, creating a cinematic presentation that mirrors the app's "flow without friction" ethos.

---

## Section-by-Section Breakdown

### 1. Hero Section (Scroll: 0% - 8%)
**Purpose:** Immediate brand recognition and primary CTA

**Content:**
- Animated logo (scales down on scroll)
- Title: "overlay" (serif typography)
- Tagline: "personal computing, reimagined"
- Download button with Apple icon: "download for mac"
- Demo link to X/Twitter post

**Theme Connection:** 
Clean, minimal presentation establishes the app's design philosophy—remove everything non-essential. The "reimagined" tagline signals innovation without being verbose.

---

### 2. Philosophy Section (Scroll: 8% - 20%)
**Purpose:** Introduce the core concept

**Content:**
- Animated text reveal: "move execution to where intent first appears,"
- Secondary line fades in: "using overlays"
- "overlays" word isolates and lingers before fading

**Scroll Animation:**
- Main text fades out
- "using" fades out
- "overlays" remains as the focal word
- Finally "overlays" fades to transition

**Theme Connection:**
This is the foundational thesis. The animation visually demonstrates the concept—strip away everything until only the core idea ("overlays") remains.

---

### 3. Voice Section (Scroll: 20% - 30%)
**Purpose:** Showcase voice interaction capability

**Content:**
- Header: "voice" / Subheader: "speak your mind"
- Interactive iMessage-style demo showing voice-to-text
- Simulated conversation: "when will you get here?" → "omw be there in 5"
- Waveform visualization during "recording"
- Instruction: "hold and release ⌥ space to respond"

**Interactions:**
- Scroll triggers text fill animation
- User can manually activate with Option+Space
- Visual feedback: waveform, processing state, message send

**Theme Connection:**
Demonstrates the first overlay type—voice as immediate communication without app switching. The iMessage UI is familiar yet enhanced with overlay-style instant access.

---

### 4. Notes Section (Scroll: 30% - 40%)
**Purpose:** Demonstrate note-taking overlay

**Content:**
- Header: "notes" / Subheader: "capture that thought"
- Screen mockup showing base application window
- Floating overlay appears on scroll (⌘/ shortcut)
- Annotation appears at 50% scroll: "capture ideas instantly without leaving your current task"

**Scroll Animation:**
- 0-40%: View base screen
- 40%+: Overlay slides in from bottom-right
- 70%+: Annotation fades in

**Theme Connection:**
The annotation explicitly states the value proposition—capturing ideas without disruption. The visual shows context preservation (base screen remains visible).

---

### 5. Chat Section (Scroll: 40% - 50%)
**Purpose:** Show AI chat overlay capability

**Content:**
- Header: "chat" / Subheader: "ask that question"
- Screen mockup with chat overlay
- Annotation at 50%: "get ai help anywhere, no app switching needed"
- Shortcut: ⌘.

**Visual Design:**
- Overlay appears from bottom-left
- Annotation positioned on right side (creates visual rhythm alternating with Notes)

**Theme Connection:**
Emphasizes AI accessibility without workflow interruption. The "anywhere" language reinforces the overlay philosophy.

---

### 6. Browser Section (Scroll: 50% - 60%)
**Purpose:** Demonstrate quick search overlay

**Content:**
- Header: "browse" / Subheader: "make that search"
- Screen mockup with browser overlay
- Annotation at 50%: "quick search without disrupting your workflow"
- Shortcut: ⌘\

**Visual Design:**
- Larger overlay (75% width) showing browser interface
- Annotation positioned above overlay

**Theme Connection:**
Completes the quartet of overlay types. The word "quick" and "without disrupting" reinforce speed and flow preservation.

---

### 7. Combo Section (Scroll: 60% - 68%)
**Purpose:** Transition / synthesis of features

**Content:**
- Text: "voice + notes + chat + browser"
- Text shrinks and fades as user scrolls
- Replaced by a small pill-shaped indicator (48×10px)
- Pill represents the unified control interface

**Animation:**
- 62-64%: Text scales down, opacity reduces
- 64-65%: Pill scales up, becomes visible
- 66-68%: Pill fades out

**Theme Connection:**
Visual metaphor for unification—four separate tools collapsing into a single, minimal control point. The pill shape foreshadows the control interface in the next section.

---

### 8. All In One Place Section (Scroll: 68% - 80%)
**Purpose:** Show unified control and simultaneous overlays

**Content:**
- Text: "all in" (above) / "one place" (below)
- Central "pill" control panel that expands on hover/scroll
- Four buttons: Voice (mic), Notes (notebook), Chat (message), Browser (globe)
- Four overlays positioned at screen edges:
  - Left: Notes overlay
  - Top: Chat overlay  
  - Right: Browser overlay
  - Bottom: Voice transcription overlay

**Scroll Animation:**
- 15%: Voice transcription appears
- 30%: Notes overlay slides in from left
- 45%: Chat overlay drops from top
- 60%: Browser overlay slides from right

**Interactions:**
- Hover expands pill to show buttons
- Click buttons toggle respective overlays
- Voice button activates recording mode with waveform visualization

**Theme Connection:**
The culmination of the narrative—all four overlays accessible from a single control point. The edge positioning demonstrates how overlays exist at the periphery of attention, ready when needed.

---

### 9. Flow Section (Scroll: 80% - 86%)
**Purpose:** Reinforce core benefit

**Content:**
- Simple text: "without breaking flow"

**Theme Connection:**
Direct statement of the app's primary value proposition. Positioned after seeing all features, this lands with context.

---

### 10. Welcome Section (Scroll: 86% - 92%)
**Purpose:** Introduce terminology and concept

**Content:**
- Text: "welcome to overlay-first computing"
- "overlay-first" styled in muted gray

**Theme Connection:**
Names the paradigm. The hyphenated "overlay-first" positions this as a computing philosophy comparable to "mobile-first" or "AI-first"—suggesting a shift in how we think about personal computing.

---

### 11. Download Section (Scroll: 92% - 100%)
**Purpose:** Final CTA and conversion

**Content:**
- Header: "begin"
- Download button (larger variant)
- Subtext: "windows coming soon"
- Footer with:
  - Logo + copyright "2026 overlay"
  - Attribution: "made with care by divyan.sh"
  - Links: terms, privacy, contact

**Theme Connection:**
"begin" is an invitation to start the journey. The footer attribution reinforces the indie/craft aesthetic.

---

## Visual Design System

### Colors
- **Background:** `#fafafa` (warm off-white)
- **Primary Text:** `#0a0a0a` (near-black)
- **Secondary Text:** `#71717a` (muted gray)
- **Tertiary Text:** `#a1a1aa` (light gray)
- **Accent:** `#007aff` (blue for interactive states)

### Typography
- **Headlines:** Serif font (elegant, editorial feel)
- **Body/UI:** System sans-serif (clean, readable)
- **Scale:** Large headlines (4xl to 6xl) create visual impact

### Visual Motifs
- **Pill shapes:** Rounded rectangles (12-28px radius) represent the overlay aesthetic—soft, approachable, non-intrusive
- **Transparency:** Glass-morphism effects suggest overlays floating above content
- **Waveforms:** Visual shorthand for voice/audio interaction
- **Minimal chrome:** Few borders, maximum whitespace

---

## Narrative Arc

The website tells a story in three acts:

### Act 1: The Problem (Philosophy)
- Context switching disrupts flow
- Current computing forces app-hopping
- Solution: overlays that appear where intent forms

### Act 2: The Solution (Features)
- Voice: Instant communication
- Notes: Instant capture
- Chat: Instant AI access
- Browser: Instant search
- Unified control from one place

### Act 3: The Vision (Conclusion)
- Flow preservation as primary benefit
- "Overlay-first computing" as new paradigm
- Call to action: Begin the journey

---

## Interactive Philosophy

The website **embodies** the app it describes:

1. **No page navigation** — Single continuous experience (like staying in one app)
2. **Scroll as progression** — Linear flow without jumps or reloads
3. **Reveals on demand** — Content appears as you "need" it through scrolling
4. **Minimal UI** — No navigation bars, sidebars, or distracting elements
5. **Immediate feedback** — Interactive demos respond instantly

The landing page is itself an **overlay experience**—floating above the traditional website paradigm, preserving the visitor's attention flow while delivering information.

---

## Key Messaging Hierarchy

| Priority | Message |
|----------|---------|
| 1 | Personal computing, reimagined |
| 2 | Move execution to where intent first appears |
| 3 | Voice + Notes + Chat + Browser |
| 4 | All in one place |
| 5 | Without breaking flow |
| 6 | Overlay-first computing |

Each message builds on the previous, creating a logical progression from concept to implementation to paradigm.
