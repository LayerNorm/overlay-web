import UIKit
import Combine

// Keyboard extension recording states
enum RecordingState: Equatable {
    case idle
    case recording      // Main app is recording in background
    case processing     // Main app is transcribing
    case done(String)
    case error(String)

    static func == (lhs: RecordingState, rhs: RecordingState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.recording, .recording), (.processing, .processing):
            return true
        case (.done(let a), .done(let b)):
            return a == b
        case (.error(let a), .error(let b)):
            return a == b
        default:
            return false
        }
    }
}

// Monologue-style architecture:
// 1. Keyboard opens Overlay app via URL
// 2. Overlay app records in background, writes audio level to App Group
// 3. Keyboard polls App Group, shows waveform
// 4. Keyboard sends "stop" command via App Group
// 5. Overlay transcribes, writes result to App Group
// 6. Keyboard reads result and inserts text

class TranscriptionService: NSObject, ObservableObject {
    @Published var state: RecordingState = .idle
    @Published var audioLevel: Float = 0.0
    @Published var backgroundModeEnabled: Bool = false

    var openURL: ((URL) -> Void)?
    var onTranscriptionReady: ((String) -> Void)?

    private let appGroupID = "group.com.layernorm.overlay-mobile"
    private let statusKey = "overlay_kb_status"
    private let resultKey = "overlay_kb_result"
    private let audioLevelKey = "overlay_kb_audio_level"
    private let recordingHeartbeatKey = "overlay_kb_recording_heartbeat"
    private let commandKey = "overlay_kb_command"
    private let backgroundModeKey = "overlay_kb_background_mode_enabled"
    private let disableBackgroundCommand = "disable_bg_mode"
    private let staleRecordingTimeout: TimeInterval = 1.0

    private var pollingTimer: Timer?
    private var startFallbackWorkItem: DispatchWorkItem?
    private var shouldDiscardNextResult = false
    private var pendingForegroundFallback = false

    private var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    override init() {
        super.init()
        backgroundModeEnabled = defaults?.bool(forKey: backgroundModeKey) ?? false
        resumeFromSharedState()
    }

    deinit {
        cancelStartFallback()
        stopPolling()
    }

    // Called when user taps mic button in keyboard - opens Overlay app
    func startRecording() {
        guard let defaults = defaults else {
            state = .error("Shared storage unavailable")
            return
        }
        shouldDiscardNextResult = false
        pendingForegroundFallback = false

        consumeDoneStateIfPresent(defaults)
        var currentStatus = defaults.string(forKey: statusKey) ?? "idle"
        if currentStatus == "recording" && !recordingHeartbeatIsFresh(defaults) {
            clearStaleRecordingState(defaults)
            currentStatus = "idle"
        }
        let sharedBackgroundMode = defaults.bool(forKey: backgroundModeKey)
        if backgroundModeEnabled != sharedBackgroundMode {
            backgroundModeEnabled = sharedBackgroundMode
        }
        if currentStatus == "done" {
            // Clear any stale completed state so Start always begins a new cycle.
            defaults.set("idle", forKey: statusKey)
            defaults.set("idle", forKey: commandKey)
            defaults.removeObject(forKey: resultKey)
            defaults.synchronize()
            currentStatus = "idle"
        }
        cancelStartFallback()

        if currentStatus == "recording" || currentStatus == "processing" {
            startPolling()
            pollAppGroup()
            return
        }

        // Clear any previous state
        defaults.set("idle", forKey: statusKey)
        defaults.set("idle", forKey: commandKey)
        defaults.removeObject(forKey: resultKey)
        defaults.set(Float(0), forKey: audioLevelKey)
        defaults.synchronize()

        state = .idle
        audioLevel = 0

        // Start polling before opening app so the keyboard immediately reflects updates.
        startPolling()
        pollAppGroup()

        if sharedBackgroundMode {
            // App stays in background and starts recording on command.
            defaults.set("start", forKey: commandKey)
            defaults.synchronize()
            pendingForegroundFallback = true
            scheduleStartTimeoutNotice()
            return
        }

        openDictationApp()
    }

    // Called when user taps stop button in keyboard
    func stopRecording() {
        cancelStartFallback()
        shouldDiscardNextResult = false
        // Send stop command to main app via App Group
        defaults?.set("stop", forKey: commandKey)
        defaults?.synchronize()
        state = .processing
        pendingForegroundFallback = false
        startPolling()
    }

    // Called when user cancels recording from keyboard strip.
    func cancelRecording() {
        guard state == .recording else { return }
        shouldDiscardNextResult = true
        cancelStartFallback()
        defaults?.set("stop", forKey: commandKey)
        defaults?.synchronize()
        state = .idle
        audioLevel = 0
        pendingForegroundFallback = false
        startPolling()
    }

    func pauseRecording() {
        guard state == .recording else { return }
        defaults?.set("pause", forKey: commandKey)
        defaults?.synchronize()
    }

    func resumeRecording() {
        guard state == .recording else { return }
        defaults?.set("resume", forKey: commandKey)
        defaults?.synchronize()
    }

    func resumeFromSharedState() {
        backgroundModeEnabled = defaults?.bool(forKey: backgroundModeKey) ?? false
        cancelStartFallback()
        pendingForegroundFallback = false
        startPolling()
        pollAppGroup()
    }

    // Poll App Group for status and audio level updates
    private func startPolling() {
        pollingTimer?.invalidate()
        pollingTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.pollAppGroup()
        }
    }

    private func stopPolling() {
        pollingTimer?.invalidate()
        pollingTimer = nil
    }

    private func pollAppGroup() {
        guard let defaults = defaults else { return }

        let sharedBackgroundMode = defaults.bool(forKey: backgroundModeKey)
        if backgroundModeEnabled != sharedBackgroundMode {
            backgroundModeEnabled = sharedBackgroundMode
        }

        let status = defaults.string(forKey: statusKey) ?? "idle"
        let level = defaults.float(forKey: audioLevelKey)

        switch status {
        case "recording":
            if !recordingHeartbeatIsFresh(defaults) {
                clearStaleRecordingState(defaults)
                NSLog("[OverlayKeyboard] Cleared stale recording state from shared storage")
                return
            }
            cancelStartFallback()
            pendingForegroundFallback = false
            if state != .recording {
                state = .recording
            }
            audioLevel = level

        case "processing":
            cancelStartFallback()
            pendingForegroundFallback = false
            state = .processing
            audioLevel = 0

        case "done":
            cancelStartFallback()
            pendingForegroundFallback = false
            stopPolling()
            consumeDoneStateIfPresent(defaults)

        case "error":
            cancelStartFallback()
            pendingForegroundFallback = false
            stopPolling()
            state = .error("Recording failed")
            audioLevel = 0

        default:
            state = .idle
            audioLevel = 0
        }
    }

    private func openDictationApp() {
        guard let url = URL(string: "overlay://dictate") else { return }
        openURL?(url)
    }

    private func scheduleStartTimeoutNotice() {
        cancelStartFallback()
        let workItem = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            let sharedStatus = self.defaults?.string(forKey: self.statusKey) ?? "idle"
            if sharedStatus == "recording" || sharedStatus == "processing" || self.state == .recording || self.state == .processing {
                return
            }
            self.state = .error("Opening app to start mic")
            NSLog("[OverlayKeyboard] Waiting for app-side recorder response in background mode")
            if self.pendingForegroundFallback {
                self.pendingForegroundFallback = false
                self.defaults?.set("start", forKey: self.commandKey)
                self.defaults?.synchronize()
                self.openDictationApp()
            }
        }
        startFallbackWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: workItem)
    }

    private func cancelStartFallback() {
        startFallbackWorkItem?.cancel()
        startFallbackWorkItem = nil
        pendingForegroundFallback = false
    }

    private func recordingHeartbeatIsFresh(_ defaults: UserDefaults) -> Bool {
        guard defaults.object(forKey: recordingHeartbeatKey) != nil else { return false }
        let lastHeartbeat = defaults.double(forKey: recordingHeartbeatKey)
        guard lastHeartbeat > 0 else { return false }
        return Date().timeIntervalSince1970 - lastHeartbeat < staleRecordingTimeout
    }

    private func clearStaleRecordingState(_ defaults: UserDefaults) {
        defaults.set("idle", forKey: statusKey)
        defaults.set("idle", forKey: commandKey)
        defaults.set(Float(0), forKey: audioLevelKey)
        defaults.synchronize()
        state = .idle
        audioLevel = 0
        cancelStartFallback()
    }

    private func consumeDoneStateIfPresent(_ defaults: UserDefaults) {
        guard defaults.string(forKey: statusKey) == "done" else { return }
        let text = defaults.string(forKey: resultKey) ?? ""

        if shouldDiscardNextResult {
            shouldDiscardNextResult = false
            defaults.set("idle", forKey: statusKey)
            defaults.set("idle", forKey: commandKey)
            defaults.removeObject(forKey: resultKey)
            defaults.synchronize()
            state = .idle
            audioLevel = 0
            pendingForegroundFallback = false
            return
        }

        state = .done(text)
        audioLevel = 0

        if !text.isEmpty {
            onTranscriptionReady?(text)
        }
    }

    func acknowledgeInsertion() {
        guard let defaults = defaults else { return }
        defaults.set("idle", forKey: statusKey)
        defaults.set("idle", forKey: commandKey)
        defaults.removeObject(forKey: resultKey)
        defaults.synchronize()
        shouldDiscardNextResult = false
        pendingForegroundFallback = false
        state = .idle
        audioLevel = 0
    }

    func setBackgroundModeEnabled(_ enabled: Bool) {
        guard let defaults = defaults else {
            state = .error("Shared storage unavailable")
            return
        }

        if enabled {
            // Enable is explicitly confirmed in app. Open app, keep toggle synced to shared truth.
            state = .error("Enable BG mic in app")
            pendingForegroundFallback = true
            openDictationApp()
            startPolling()
            pollAppGroup()
            backgroundModeEnabled = defaults.bool(forKey: backgroundModeKey)
            return
        }

        // Disable should happen immediately from keyboard without opening app.
        cancelStartFallback()
        backgroundModeEnabled = false
        state = .idle
        audioLevel = 0
        pendingForegroundFallback = false
        defaults.set(false, forKey: backgroundModeKey)
        defaults.set(disableBackgroundCommand, forKey: commandKey)
        defaults.set("idle", forKey: statusKey)
        defaults.set(Float(0), forKey: audioLevelKey)
        defaults.synchronize()
        startPolling()
        pollAppGroup()
    }

    func reset() {
        cancelStartFallback()
        stopPolling()
        shouldDiscardNextResult = false
        pendingForegroundFallback = false
        state = .idle
        audioLevel = 0
        defaults?.set("idle", forKey: statusKey)
        defaults?.set("idle", forKey: commandKey)
        defaults?.synchronize()
    }
}
