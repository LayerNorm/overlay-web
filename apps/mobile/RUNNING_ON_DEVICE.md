cccccc# Running Dawn on iPhone

This project uses [`expo-dev-client`](https://docs.expo.dev/develop/development-builds/introduction/), which means the **recommended way** to run it is with a **development build** — a custom native app installed directly on your device. Expo Go is supported for quick iteration but has limitations (see [Expo Go](#option-b-expo-go-quick-iteration) below).

---

## Option A — Development Build (Recommended)

A development build gives you full access to all native modules (including `@10play/tentap-editor`, `expo-av` microphone, etc.).

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Xcode](https://developer.apple.com/xcode/) with a valid Apple ID / developer account
- iPhone connected via USB **or** on the same Wi-Fi network
- [EAS CLI](https://docs.expo.dev/eas/) (optional, for cloud builds): `npm install -g eas-cli`

### Step 1 — Install Dependencies

```bash
npm install
```

### Step 2 — Build & Install the Development Client

**Option 2a — Local build (requires Xcode, builds directly to your device):**

```bash
npx expo run:ios --device
```

Expo will prompt you to select your connected iPhone. Xcode will compile and install the `Dawn (dev)` app on your device. This takes a few minutes on first run.

**Option 2b — Cloud build via EAS (no Xcode required):**

```bash
eas build --profile development --platform ios
```

Download the resulting `.ipa` and install it via [Apple Configurator 2](https://apps.apple.com/us/app/apple-configurator-2/id1037126344) or TestFlight.

### Step 3 — Start the Development Server

Once the dev client app is installed on your device, start Metro:

```bash
npx expo start
```

Terminal output will look like:

```
› Metro waiting on exp+dawn-mobile://expo-development-client/?url=http%3A%2F%2F192.168.1.249%3A8081
› Scan the QR code above to open the project in a development build.
› Using development build
```

### Step 4 — Connect Your Device

1. Open the **Dawn (dev)** app on your iPhone.
2. Scan the QR code shown in the terminal, **or** enter the server URL manually.
3. The Metro bundler will compile the JS bundle and the app will load.

> **Tip:** Hot reloading works automatically — save any file and the app updates instantly.

---

## Option B — Expo Go (Quick Iteration)

Use this when you don't need native modules beyond the Expo SDK. Some features (rich text editor, custom audio pipelines) may not work.

### Prerequisites

- [Expo Go](https://apps.apple.com/us/app/expo-go/id982107779) installed on your iPhone
- iPhone and Mac on the **same Wi-Fi network**

### Steps

```bash
npm install
npx expo start --go
```

The `--go` flag forces Expo Go mode (without it the server defaults to development build mode because `expo-dev-client` is installed).

Terminal output:

```
› Metro waiting on exp://192.168.1.249:8081
› Scan the QR code above with Expo Go (Android) or the Camera app (iOS)
› Using Expo Go
```

Open the iPhone **Camera app**, scan the QR code, and tap **"Open in Expo Go"**.

---

## Development Server — Useful Keyboard Shortcuts

Once `npx expo start` (or `--go`) is running, the terminal accepts these keys:

| Key | Action |
|-----|--------|
| `r` | Reload the app |
| `m` | Toggle in-app developer menu |
| `j` | Open JS debugger |
| `s` | Switch between Expo Go / development build |
| `i` | Open in iOS Simulator |
| `w` | Open in browser |
| `Ctrl+C` | Stop the server |

---

## Troubleshooting

### Device not found by `expo run:ios`
- Ensure the iPhone is trusted on your Mac (accept the "Trust This Computer" prompt).
- Try a different USB cable or port.

### Metro can't reach the device over Wi-Fi
- Confirm both devices are on the same network.
- Run `npx expo start --tunnel` to route through Expo's tunnel (slower but bypasses firewall issues).

### Port 8081 already in use
```bash
kill $(lsof -ti:8081)
npx expo start
```

### "Unable to determine redirect location" warning
- This is a cosmetic warning from the dev client middleware. It does not affect functionality.

---

## Project Info

| Field | Value |
|-------|-------|
| App name | Dawn |
| Slug | `dawn-mobile` |
| Expo SDK | ~54 |
| React Native | 0.81.5 |
| Bundle ID (iOS) | `com.anonymous.dawn-mobile` |
| Entry point | `expo-router/entry` |
| Deep link scheme | `dawn://` |
