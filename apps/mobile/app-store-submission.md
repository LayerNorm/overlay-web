# Overlay — App Store Submission Guide

Everything App Store Connect will ask for, plus the open compliance items
you still need to clear before you can hit "Submit for Review."

---

## 1. App Store Connect — App Information

| Field | Value |
|---|---|
| **App Name** | Overlay |
| **Subtitle** (30 char max) | AI workspace for chat & notes |
| **Bundle ID** | `com.layernorm.overlay-mobile` |
| **SKU** | `overlay-mobile-001` |
| **Apple ID (ASC)** | `6765998182` |
| **Primary Category** | Productivity |
| **Secondary Category** | Utilities |
| **Content Rights** | Does NOT contain, show, or access third-party content |
| **Age Rating** | 17+ (Frequent/Intense Mature/Suggestive Themes — Unrestricted Web Access; AI-generated content) |

### URLs

| Field | URL |
|---|---|
| Marketing URL | `https://www.getoverlay.io` |
| Support URL | `https://www.getoverlay.io/support` |
| Privacy Policy URL | `https://www.getoverlay.io/privacy` |

---

## 2. Pricing & Availability

- **Price tier:** Free
- **In-App Purchases:** None for v1.0.0
- **Availability:** All territories (recommended) — restrict only if you don't want to translate the description.
- **Pre-order:** No

> ⚠️ Because the app is free and contains zero purchases or paywalls in-app
> (see §10 below), Apple's reviewer should not ask for IAP wiring. Premium
> models are silently locked with a generic "available on a paid plan" notice
> — no prices, no buttons that route to Stripe.

---

## 3. App Store Listing Copy

### Promotional Text (170 char, editable without re-review)

> Overlay is your model-agnostic AI workspace. Chat with the best models, capture notes, and build a knowledge base — all in one fast, beautifully simple app.

### Description (4000 char max)

```
Overlay is the AI workspace that finally feels like one app instead of ten.

Chat with the best models — GPT, Claude, Gemini, Grok, Llama, and dozens
more — without juggling subscriptions or copy-pasting between tabs.
Take notes that live next to your chats. Build a personal knowledge base
your AI can actually use. Bring your work, your context, and your taste
into one place.

WHY OVERLAY

• One app, every model. Switch between frontier models mid-conversation
  without losing context.
• Notes that think with you. Write in a clean, fast editor; ask Overlay
  to edit, summarize, or extend any selection.
• Knowledge that compounds. Save memories, upload files, and let your
  AI reference them automatically.
• Image and document attachments. Drop a screenshot, a PDF, or a photo
  into chat — Overlay handles the rest.
• Built for focus. No clutter, no notifications you didn't ask for,
  no dark patterns. Just a clean workspace that gets out of the way.

DESIGNED FOR THINKING

Overlay is built around how you actually use AI: short bursts of
chat, longer-form notes, and a quiet pile of context that keeps
growing. Everything syncs to your account so you can pick up where
you left off on the web at getoverlay.io.

PRIVACY FIRST

Your chats and notes are yours. We don't train models on your data.
You can delete your account and all associated content directly
from the Settings screen at any time.

Read our privacy policy: https://www.getoverlay.io/privacy
Read our terms of service: https://www.getoverlay.io/terms

Sign in with Apple, Google, Microsoft, or email. Free to use. Premium
models available on paid plans managed at getoverlay.io.
```

### Keywords (100 char max, comma-separated)

```
ai,chat,gpt,claude,gemini,assistant,notes,workspace,knowledge,productivity,writing,llm,grok,llama
```

### What's New in This Version (4000 char max)

```
First public release of Overlay for iOS.

• Chat with multiple frontier AI models in one place
• Notes editor with AI-assisted writing
• Personal knowledge base — memories, files, outputs
• Sign in with Apple, Google, Microsoft, or email
• Light and dark themes, iPad support
```

---

## 4. App Privacy (App Store Connect "App Privacy" tab)

Mark the following data types as collected. The app reviewer cross-checks
this against your privacy policy, so be honest and consistent.

| Data Type | Collected? | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| **Email Address** | Yes | Yes | No | Account, App Functionality, Customer Support |
| **Name** | Yes | Yes | No | Account, App Functionality |
| **User ID** | Yes | Yes | No | Account, App Functionality, Analytics |
| **Photos** (only when user attaches) | Yes | Yes | No | App Functionality |
| **Audio** (only when user records) | Yes | Yes | No | App Functionality |
| **Other User Content** (chat messages, notes, knowledge files) | Yes | Yes | No | App Functionality |
| **Crash Data** | Yes | No | No | Analytics |
| **Performance Data** | Yes | No | No | Analytics |
| **Product Interaction** | Yes | No | No | Analytics |

> ⚠️ **Tracking:** Mark **"No"** for "Used to track you" everywhere. The app
> does not currently integrate any ad SDK or cross-app tracking. If you ever
> add Facebook/Google Ads, AppsFlyer, etc., you must add ATT
> (`expo-tracking-transparency`) before shipping.

---

## 5. Review Information (App Store Connect "App Review" tab)

| Field | Value |
|---|---|
| First name | Divyansh |
| Last name | Lalwani |
| Email | divyansh@layernorm.co |
| Phone | +1 (667) 770-8382 |
| **Demo account email** | **⚠️ FILL IN BEFORE SUBMITTING** |
| **Demo account password** | **⚠️ FILL IN BEFORE SUBMITTING** |
| Sign-in required? | Yes |
| Notes for reviewer | See block below |

### Notes for the reviewer (paste into "Notes")

```
Thank you for reviewing Overlay.

DEMO ACCOUNT
Email:    [fill in]
Password: [fill in]

The demo account is pre-populated with one chat thread, two notes, one
saved memory, and one knowledge file so reviewers can see core
functionality without waiting on data.

WHAT OVERLAY DOES
Overlay is an AI workspace. Sign-in is required because every chat,
note, and piece of knowledge is tied to a user account and synced to
the user's web workspace at https://www.getoverlay.io.

PURCHASES
The app is free. There are no in-app purchases. Premium AI models
(e.g. GPT-4 class, Claude Opus class) are gated to paid Overlay
accounts; the demo account is on the free tier and can use all
free models. The free tier is fully functional.

ACCOUNT DELETION
Settings → Legal & privacy → "Delete account" initiates account
deletion within the app, opening a confirmation flow that finishes
on our website (this is the same path used by signed-in users).

PERMISSIONS
- Camera & Photo Library: only requested when a user taps the
  attach button in chat and chooses Camera or Photos.
- Microphone: only requested if the user taps the (currently
  hidden) voice feature. The voice surface is not exposed in this
  build's sidebar; the permission string remains in case a future
  background-recording flow is re-enabled.

DEEP LINK SCHEME
overlay://

Contact for any questions:
Divyansh Lalwani — divyansh@layernorm.co — +1 (667) 770-8382
```

### Sign-In Information toggle

Set "Sign-in required" to **Yes** and provide the demo credentials.

---

## 6. Build Settings (already in repo — verify before next EAS build)

- `app.json` → `expo.version`: **`1.0.0`**
- `app.json` → `expo.ios.buildNumber`: **bump on every TestFlight upload**
  (EAS `production` profile has `autoIncrement: true`, so this auto-bumps).
- `app.json` → `expo.ios.infoPlist.ITSAppUsesNonExemptEncryption`: `false` ✅
- `eas.json` → `submit.production.ios.ascAppId`: `6765998182` ✅

### Info.plist (post-cleanup)

Already updated in `ios/Overlay/Info.plist`:

- ✅ Removed unused `UIBackgroundModes` (`fetch`, `remote-notification`).
- ✅ Removed unused `NSFaceIDUsageDescription` (no Local Authentication).
- ✅ Removed dev-only `NSBonjourServices` and `NSLocalNetworkUsageDescription`.
- ✅ Specific purpose strings for camera, microphone, photo library.

---

## 7. Screenshots (App Store Connect requires at least 1 size)

Minimum required:

| Device | Size | Count |
|---|---|---|
| iPhone 6.9" (Pro Max) | 1320×2868 (or 2868×1320) | 3–10 |
| iPhone 6.5" (older Plus) | 1284×2778 | 3–10 |
| iPad 13" (Pro M4) | 2064×2752 | 3–10 (only if `supportsTablet: true`, which we have) |

Suggested screen list (use real demo content — no Lorem ipsum):

1. Chat with model picker open showing Claude/GPT/Gemini side by side.
2. A long, polished chat answer with markdown formatting.
3. Notes editor with AI rewrite menu.
4. Knowledge view (memories or files).
5. Sidebar / multi-surface overview.
6. Settings → Legal & privacy (shows account deletion is in-app).

> Apple's reviewer specifically checks that screenshots match what's
> actually shippable. Don't show the Voice tab — it's grandfathered out.

### App Preview Video (optional, recommended)

15–30s, no audio narration required. Simple screen capture of: open
app → chat → notes → settings.

---

## 8. App Icon & Marketing Asset Checklist

- ✅ 1024×1024 App Store icon (`ios/Overlay/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png`).
- No transparency, no rounded corners (Apple rounds them).
- Same artwork as the in-app icon — Apple flags mismatch.

---

## 9. Compliance Audit Results

The following changes were made in this pass to clear App Store rejection
risks. Each one maps to a specific guideline.

### ✅ Fixed in this PR

| # | Guideline | Risk before | Fix |
|---|---|---|---|
| 1 | **5.1.1(v) — Account deletion** | No in-app way to delete account. Automatic rejection since 2022-06-30. | Settings → Legal & privacy → **Delete account** opens an in-app confirmation, then routes to the web flow. |
| 2 | **3.1.1 / 3.1.3 — Out-of-app purchase** | `UpgradePrompt` showed monthly prices ($8/$24/$96) and a "See all plans" button that opened Stripe Checkout. Classic anti-steering rejection. | Modal now shows no prices and no external link. Just a generic "available on a paid plan" notice with a single "Got it" button. Auto-popup for free-tier users on chat load was also removed. |
| 3 | **5.1.1 — Privacy policy in app** | Privacy/Terms only reachable from the auth screen. | Added Privacy policy + Terms of service rows in Settings. |
| 4 | **5.1.1(i) — Specific purpose strings** | `Info.plist` had generic "Allow Overlay to access your camera." | Rewrote `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription` to describe the exact in-app feature that triggers the prompt. |
| 5 | **2.5.4 — Background modes misuse** | `UIBackgroundModes` declared `fetch` and `remote-notification` but the app uses neither. | Removed both from `app.json` and `Info.plist`. |
| 6 | **2.3 — Misleading metadata / dev artifacts** | `NSBonjourServices: _expo._tcp` and an `NSLocalNetworkUsageDescription` mentioning "Expo Dev Launcher" were shipping in production. | Removed both. |
| 7 | **5.1.1(i) — Permission match** | `NSFaceIDUsageDescription` declared without any `LocalAuthentication` usage. Reviewer often asks "where is this used?" | Removed the key. |
| 8 | **2.1 — App completeness** | The Voice tab depends on the `OverlayKeyboard` extension that was removed in the last commit. Shipping a tab that no-ops or crashes triggers 2.1. | Voice removed from sidebar `NAV_ITEMS` (route file kept so deep links don't crash; UI entry point hidden). |

### ⚠️ Still requires action from you

| # | Item | Where | Why |
|---|---|---|---|
| A | **Fill in demo account credentials** | `review-notes.md` and ASC review notes | Without these, automatic rejection under 2.1 / 4.2. |
| B | ~~Build the web "Delete account" flow~~ — **DONE** | `src/components/account/DeleteAccountSection.tsx` + `src/app/api/account/delete/route.ts` + `convex/users.ts → deleteUserAccountByServer` | The web account page now auto-opens a typed-confirmation modal whenever it is loaded with `?delete=1`. The API route cancels Stripe, wipes Convex rows, purges R2 blobs, deletes the WorkOS user, and clears the session cookie. Run `bun run convex:push:all` after pulling so the new Convex mutation is deployed. |
| C | **Verify the demo account can use the free tier** end-to-end | TestFlight with reviewer creds | Reviewer will sign in fresh on a clean device. |
| D | **Take 6.9" iPhone screenshots** | App Store Connect | Apple requires at least one device size. |
| E | **Bump build number** before re-uploading | EAS build | `autoIncrement: true` will handle this if you build via EAS. |
| F | **Confirm OAuth redirects work in TestFlight build** | Manual QA | The `WebBrowser.openAuthSessionAsync` flow uses `overlay://auth/transfer` — make sure the transfer page on the production web app is live. |

### 🟡 Not required for v1, but recommended before v2

- Add `expo-tracking-transparency` and an ATT prompt **before** integrating
  any analytics/ad SDK that fingerprints users (PostHog with `$device_id`
  enabled is borderline — review their docs).
- Replace the deep-link "Continue to delete" web hop with an in-app API call
  to a Convex `deleteUser` mutation. Cleaner UX, removes one Apple rejection
  surface.
- If you want to take payments inside the iOS app later, evaluate
  StoreKit 2 (`expo-iap`) or apply for the External Link Account Entitlement
  (US only) and restore the original `UpgradePrompt` from git.

---

## 10. Encryption / Export Compliance

Already declared in `app.json`:

```json
"ITSAppUsesNonExemptEncryption": false
```

This is correct **only if** all of the following are true (they are today):

- The app uses HTTPS but does not implement its own crypto.
- The app does not call any non-exempt cryptographic APIs.
- The app does not transmit financial data using its own encryption.

If you ever add E2EE for chats or use a custom cipher, flip this to `true`
and provide the export-compliance documents.

---

## 11. Submission Day — Step-by-step

1. `cd overlay-mobile && eas build --platform ios --profile production`
2. Wait for build to finish (~10 min).
3. `eas submit --platform ios --latest` (uploads the IPA to App Store Connect).
4. In App Store Connect:
   - Open the new build under TestFlight.
   - Add a TestFlight test note ("v1.0.0 — initial release").
   - Wait for "Ready to Submit."
5. Open the app version page (1.0.0):
   - Paste description, keywords, promotional text, what's-new.
   - Upload screenshots (6.9", 6.5", iPad if you support it).
   - Fill App Privacy answers (§4 above).
   - Fill App Review information + demo creds (§5 above).
   - Encryption: "No" (matches `ITSAppUsesNonExemptEncryption: false`).
   - Content Rights: "No, it does not contain..."
   - Age Rating: 17+.
6. **Submit for Review.**

Typical review time: 24–48 hours for the first build.
