# App Store Screenshots Checklist

## Required iPhone Sizes

| Size | Devices | Dimensions | Status |
|------|---------|------------|--------|
| 6.7" | iPhone 16 Pro Max, 15 Pro Max, 14 Pro Max | 1290×2796 | ⬜ |
| 6.5" | iPhone 14 Plus, 13 Pro Max, 12 Pro Max | 1284×2778 | ⬜ |
| 5.5" | iPhone 8 Plus, SE 3rd gen | 1242×2208 | ⬜ |

## Optional but Recommended iPad Sizes

| Size | Devices | Dimensions | Status |
|------|---------|------------|--------|
| 12.9" 2nd gen | iPad Pro | 2048×2732 | ⬜ |
| 12.9" 6th gen | iPad Pro M2 | 2048×2732 | ⬜ |

## Screenshot Content (5–6 per size)

1. **Chat screen** — AI conversation with context
2. **Notes editor** — Rich text notebook
3. **Knowledge/files** — Organized file tree
4. **Projects view** — Project-based workspace
5. **Settings/profile** — Account and preferences
6. **Memory/outputs** — Saved context or generated media

## How to Generate

Option A: iOS Simulator
```bash
# Boot iPhone 16 Pro Max simulator
xcrun simctl boot "iPhone 16 Pro Max"
# Build and run your app
bun run ios
# Use Cmd+S in Simulator to save screenshots
```

Option B: Physical device screenshots
- Build via TestFlight when ready
- Install on iPhone, take screenshots
- AirDrop to Mac

Option C: Screenshot generation tools
- Use tools like Screenshot Producer, AppLaunchpad, etc.

## App Preview Video (Optional)
- 15–30 second screen recording
- Show core flows: chat, notes, projects
- Can record in Simulator with `xcrun simctl io booted recordVideo preview.mp4`
