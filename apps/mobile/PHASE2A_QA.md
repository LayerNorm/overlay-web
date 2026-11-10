# Phase 2a entry and shell

The production shell uses real Convex memberships, agent directories, thread bundles and activity, personal chats, room directories and notifications. Room badges count unread notifications, not unread messages; personal chat dots use the canonical chat `unread` field. The room directory requests the backend maximum of 500 rooms. No backend endpoint was invented.

The old onboarding redirect is replaced at launch by membership loading and the no-workspace gate. Existing members go to their saved start destination. Legacy per-screen drawers no longer render; the root drawer also covers detail routes. Empty Projects and Knowledge Base directories were untracked and were removed.

## Open product decision

The approved sign-in mockup shows an in-app password form. Existing native authentication only supports a hosted PKCE browser session. This slice retains that secure handoff and does not collect an unused password or add a credential endpoint. Owner approval or a separate auth backend decision is still needed for exact sign-in mockup parity.

## Local checks

```sh
npm run check
node --test scripts/phase0.test.cjs scripts/phase1.test.cjs scripts/phase2a.test.cjs
npx expo export --platform android --source-maps --no-bytecode --output-dir /home/ubuntu/mobile-drift-audit/phase2a-android-export
npx expo export --platform ios --source-maps --no-bytecode --output-dir /home/ubuntu/mobile-drift-audit/phase2a-ios-export
```

Type checking uses the generated web Convex types. Adapter tests are mocked, not evidence of a live signed-in session.

## Android SDK

SDK location: `/home/ubuntu/android-sdk`. KVM was already usable; no permission change was needed. The API 35 x86_64 Google APIs image booted (`sys.boot_completed=1`). The first native build failed downloading Gson from Maven Central with HTTP 429. A local Gradle mirror init script fixed resolution. The next x86_64 debug build succeeded in 10m 43s, with 573 actionable tasks.

Reproducible installation commands below normalize the download staging paths and preinstall the packages that Gradle installed automatically during the successful build. Java 17 was already installed. The installed compile platform is 36; the emulator image is API 35.

```sh
export ANDROID_HOME="$HOME/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
mkdir -p "$ANDROID_HOME/cmdline-tools" "$HOME/android-sdk-download"
curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -o "$HOME/android-sdk-download/cmdtools.zip"
unzip -q "$HOME/android-sdk-download/cmdtools.zip" -d "$HOME/android-sdk-download"
mv "$HOME/android-sdk-download/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --install "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1" "system-images;android-35;google_apis;x86_64"
printf 'no\n' | avdmanager create avd -n overlay_test -k "system-images;android-35;google_apis;x86_64" -d pixel_6
emulator -accel-check
emulator -avd overlay_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -memory 2048
adb shell getprop sys.boot_completed
npx expo prebuild --platform android --no-install
./android/gradlew -p android app:assembleDebug -x lint -x test --configure-on-demand --build-cache -PreactNativeDevServerPort=8081 -PreactNativeArchitectures=x86_64 --max-workers=2
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

`avdmanager` does not accept the blueprint's `--sdk_root` global flag. Set `ANDROID_HOME` instead. The generated `android/` directory is build output, not part of this change.

The successful build used this local file at `~/.gradle/init.d/maven-mirror.init.gradle`:

```groovy
beforeSettings { s -> s.pluginManagement.repositories.maven { url = uri('https://maven-central.storage-download.googleapis.com/maven2/') } }
settingsEvaluated { s ->
  s.pluginManagement.repositories.configureEach { r ->
    if (r instanceof MavenArtifactRepository && (r.url.toString().contains('repo.maven.apache.org') || r.url.toString().contains('repo1.maven.org'))) r.url = uri('https://maven-central.storage-download.googleapis.com/maven2/')
  }
  s.dependencyResolutionManagement.repositories.maven { url = uri('https://maven-central.storage-download.googleapis.com/maven2/') }
}
allprojects {
  buildscript.repositories.maven { url = uri('https://maven-central.storage-download.googleapis.com/maven2/') }
  repositories.configureEach { r ->
    if (r instanceof MavenArtifactRepository && (r.url.toString().contains('repo.maven.apache.org') || r.url.toString().contains('repo1.maven.org'))) r.url = uri('https://maven-central.storage-download.googleapis.com/maven2/')
  }
  repositories.maven { url = uri('https://maven-central.storage-download.googleapis.com/maven2/') }
}
```

## Visual QA fixtures

`scripts/ShellFixture.tsx` renders the actual native entry, sidebar and account components with explicit sample data. It is not a production route and does not bypass authentication. Live signed-in data and workspace switching require an isolated test backend/session and were not verified here.

```sh
npx expo start --dev-client --localhost --port 8081
node scripts/serve-native-shell-preview.cjs
adb shell wm size 1170x2532
adb shell wm density 480
adb shell am start -W -a android.intent.action.VIEW -d 'exp+overlay://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8032%2F%3Fscreen%3Dagents-drawer%26theme%3Dlight' com.layernorm.overlay_mobile
```

The manifest server binds only to loopback. It substitutes a separate fixture bundle in the local development manifest; the production app entry is unchanged. Available states: `boot`, `sign-in`, `workspace-gate`, `account-sheet`, `agents-drawer`, `chats-drawer`, `offline`. Use `theme=light` or `theme=dark`. The dev-only Expo floating Tools button can be hidden by setting its local `showFab` preference to false.

The web fixture uses the same components:

```sh
node scripts/build-shell-preview.cjs /home/ubuntu/mobile-drift-audit/phase2a-shell
python3 -m http.server 8031 --bind 127.0.0.1 --directory /home/ubuntu/mobile-drift-audit/phase2a-shell
```

Open `http://127.0.0.1:8031/?screen=agents-drawer&theme=dark`. Web rendering needs the SDK-compatible local `react-dom` version; otherwise this nested checkout resolves the parent web renderer, which has a different React version.

Screenshots and comparison PNGs live in `/home/ubuntu/mobile-drift-audit/phase2a-shell/`. The 40px boot wordmark follows the explicit implementation requirement; the approved static mockup uses a smaller wordmark. Sign-in deliberately differs pending the auth decision above. Other feature content behind sheets/drawers remains a fixture or the existing Phase 1 screen, not a Phase 2b rebuild.

Verified locally: `npm run check` passed, 39 tests passed, targeted ESLint passed with no warnings, and Android/iOS exports passed. Source maps contain no application Convex backend modules, unresolved alias modules or QA fixture modules. All seven fixture states were captured on Android in both themes and paired with the approved PNGs. Web checks covered both themes, thread collapse/expand, opening the account sheet, changing the selected fixture workspace and the chat action. The actual application separately launched to sign-in in both system themes with no red screen, and disabling emulator Wi-Fi/data caused NetInfo to display the offline banner. Networks were restored afterward. Signed-in backend integration remains unverified.
