# Running the Mobile App on Your iPhone (Dev Server)

## Prerequisites

- **iPhone** with the [Expo Go](https://apps.apple.com/app/expo-go/id982107779) app installed
- **Mac** and iPhone on the **same Wi-Fi network**
- Node.js installed on your Mac

## Quick Start

From the repo root:

```bash
cd mobile
npx expo start
```

This starts the Metro bundler dev server. You'll see a QR code in the terminal.

### Connect your iPhone

1. Open the **Camera** app on your iPhone
2. Point it at the **QR code** in the terminal
3. Tap the Expo Go banner that appears — the app will load

Alternatively, open **Expo Go** on your phone and tap **Scan QR code**.

## Dev Client (Custom Native Modules)

Because this project uses native modules like `expo-av` and `expo-secure-store`, **Expo Go may not work**. You need a development build instead:

```bash
cd mobile
npx expo run:ios --device
```

This will:

1. Build the native iOS project
2. Show a list of connected devices (select your iPhone)
3. Install the dev build on your phone
4. Start the Metro bundler

> Your iPhone must be connected via **USB** and you must **trust** the computer on the device.

### Subsequent runs

Once the dev build is installed, you only need the Metro bundler:

```bash
cd mobile
npx expo start --dev-client
```

Then open the **Overlay** app on your phone — it will connect to the dev server automatically.

## Tunnel Mode (Different Networks)

If your Mac and iPhone are on different networks (e.g. corporate Wi-Fi with client isolation):

```bash
cd mobile
npx expo start --tunnel
```

This routes traffic through `ngrok`. Install it if prompted:

```bash
npm install -g @expo/ngrok
```

## Common Issues

| Problem                      | Fix                                                                  |
| ---------------------------- | -------------------------------------------------------------------- |
| QR code won't scan           | Try `--tunnel` mode or check both devices are on the same Wi-Fi      |
| "No development build" error | Run `npx expo run:ios --device` first to install the dev client      |
| Metro bundler port conflict  | Kill other Metro instances or use `npx expo start --port 8082`       |
| Microphone not working       | Rebuild with `npx expo run:ios --device` after adding `expo-av`      |
| Build fails on device        | Ensure you have a valid Apple Developer account set in Xcode signing |

## Useful Flags

| Flag           | Description                                       |
| -------------- | ------------------------------------------------- |
| `--dev-client` | Connect to an already-installed development build |
| `--tunnel`     | Use ngrok tunnel instead of LAN                   |
| `--port <N>`   | Custom Metro port                                 |
| `--clear`      | Clear Metro bundler cache                         |
| `--device`     | Target a physical device (USB)                    |

## Full Rebuild

If native dependencies change (new plugin in `app.json`, new native module, etc.):

```bash
cd mobile
npx expo run:ios --device
```

This re-runs `pod install` and rebuilds the native project.
