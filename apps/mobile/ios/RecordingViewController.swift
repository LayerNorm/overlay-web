import UIKit
import AVFoundation

private let appGroupID = "group.com.layernorm.overlay-mobile"
private let statusKey = "overlay_kb_status"
private let resultKey = "overlay_kb_result"
private let audioLevelKey = "overlay_kb_audio_level"
private let recordingHeartbeatKey = "overlay_kb_recording_heartbeat"
private let commandKey = "overlay_kb_command"
private let backgroundModeKey = "overlay_kb_background_mode_enabled"
private let disableBackgroundCommand = "disable_bg_mode"
private let groqKeyName = "groq_api_key"
private let authTokenKey = "overlay_kb_auth_token"
private let authBaseURLKey = "overlay_kb_auth_base_url"
private let authUserIdKey = "overlay_kb_auth_user_id"

class RecordingViewController: UIViewController {

    // MARK: - UI (Swipe Back Screen)
    private let titleLabel: UILabel = {
        let l = UILabel()
        l.text = "Swipe back to your app"
        l.textColor = .black
        l.font = .systemFont(ofSize: 26, weight: .bold)
        l.textAlignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let subtitleLabel: UILabel = {
        let l = UILabel()
        l.text = "We wish you didn't have to switch apps to use Overlay, but Apple now requires it to activate the microphone."
        l.textColor = UIColor(white: 0.4, alpha: 1)
        l.font = .systemFont(ofSize: 15)
        l.textAlignment = .center
        l.numberOfLines = 0
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let closeButton: UIButton = {
        let b = UIButton(type: .system)
        let config = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
        b.setImage(UIImage(systemName: "xmark.circle.fill", withConfiguration: config), for: .normal)
        b.tintColor = UIColor(white: 0.5, alpha: 1)
        b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }()

    private let backgroundModeLabel: UILabel = {
        let l = UILabel()
        l.text = "Background mic"
        l.textColor = UIColor(white: 0.5, alpha: 1)
        l.font = .systemFont(ofSize: 12, weight: .regular)
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let backgroundModeSwitch: UISwitch = {
        let s = UISwitch()
        s.onTintColor = UIColor(red: 0.2, green: 0.8, blue: 0.4, alpha: 1)
        s.translatesAutoresizingMaskIntoConstraints = false
        return s
    }()

    private let phoneCardContainer: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(white: 0.96, alpha: 1)
        v.layer.cornerRadius = 24
        v.layer.borderWidth = 1
        v.layer.borderColor = UIColor(white: 0.88, alpha: 1).cgColor
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let swipeBar: UIView = {
        let v = UIView()
        v.backgroundColor = UIColor(white: 0.94, alpha: 1)
        v.layer.cornerRadius = 12
        v.layer.borderWidth = 1
        v.layer.borderColor = UIColor(white: 0.85, alpha: 1).cgColor
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let swipeBarLabel: UILabel = {
        let l = UILabel()
        l.text = "Swipe right on the bar below"
        l.textColor = UIColor(white: 0.4, alpha: 1)
        l.font = .systemFont(ofSize: 13, weight: .medium)
        l.textAlignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let swipeHandIcon: UIImageView = {
        let config = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
        let iv = UIImageView(image: UIImage(systemName: "hand.draw.fill", withConfiguration: config))
        iv.tintColor = UIColor(white: 0.5, alpha: 1)
        iv.translatesAutoresizingMaskIntoConstraints = false
        iv.contentMode = .scaleAspectFit
        return iv
    }()

    private let statusLabel: UILabel = {
        let l = UILabel()
        l.text = "🎙️ Recording..."
        l.textColor = UIColor(red: 0.2, green: 0.7, blue: 0.4, alpha: 1)
        l.font = .systemFont(ofSize: 14, weight: .medium)
        l.textAlignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    /// When true, the controller is hosted as an invisible child of the root
    /// view controller and skips its UI. It still owns the audio session,
    /// command poller, and transcription pipeline. Set from AppDelegate.
    var headlessMode: Bool = false

    // MARK: - State
    private var audioRecorder: AVAudioRecorder?
    private var standbyRecorder: AVAudioRecorder?
    private var standbyRecordingURL: URL?
    private var isStandbyCaptureActive = false
    private var meteringTimer: Timer?
    private var commandTimer: Timer?
    private var recordingURL: URL?
    private var isAudioSessionConfigured = false
    private var isStartInProgress = false
    private var pendingBackgroundStart = false
    private var nextStartRetryAt: Date = .distantPast
    private var startRetryBackoff: TimeInterval = 0.4
    private var lastStandbyAttemptAt: Date = .distantPast
    private var notificationTokens: [NSObjectProtocol] = []

    private var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    private var groqAPIKey: String? {
        defaults?.string(forKey: groqKeyName)
    }

    private var isBackgroundModeEnabled: Bool {
        defaults?.bool(forKey: backgroundModeKey) ?? false
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        if !headlessMode {
            view.backgroundColor = .white
            setupUI()
            backgroundModeSwitch.isOn = isBackgroundModeEnabled
        } else {
            view.isHidden = true
            view.backgroundColor = .clear
        }
        registerLifecycleObservers()
        logAppGroupDiagnostics()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !headlessMode {
            backgroundModeSwitch.setOn(isBackgroundModeEnabled, animated: false)
        }
        if isBackgroundModeEnabled {
            startCommandPolling()
            let command = defaults?.string(forKey: commandKey) ?? "idle"
            if command == "start" {
                writeCommand("idle")
                pendingBackgroundStart = true
                nextStartRetryAt = .distantPast
                attemptPendingBackgroundStart(reason: "viewDidAppear")
            } else if audioRecorder?.isRecording == true {
                statusLabel.text = "🎙️ Recording..."
                ensureRecordingStatus()
            } else {
                statusLabel.text = "🟢 Background mic mode is on"
                ensureStandbyCaptureIfNeeded(reason: "viewDidAppear")
            }
            return
        }

        requestMicrophoneAndStartRecording()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Don't stop recording when view disappears - keep recording in background
    }

    deinit {
        unregisterLifecycleObservers()
        cleanup()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.addSubview(closeButton)
        view.addSubview(titleLabel)
        view.addSubview(subtitleLabel)
        view.addSubview(phoneCardContainer)
        view.addSubview(swipeBar)
        swipeBar.addSubview(swipeBarLabel)
        swipeBar.addSubview(swipeHandIcon)
        view.addSubview(statusLabel)
        view.addSubview(backgroundModeLabel)
        view.addSubview(backgroundModeSwitch)

        // Phone card content — mic waveform illustration
        let micIcon = UIImageView(image: UIImage(systemName: "waveform.and.mic", withConfiguration: UIImage.SymbolConfiguration(pointSize: 48, weight: .medium)))
        micIcon.tintColor = UIColor(white: 0.7, alpha: 1)
        micIcon.translatesAutoresizingMaskIntoConstraints = false
        micIcon.contentMode = .scaleAspectFit
        phoneCardContainer.addSubview(micIcon)

        let recordingDot = UIView()
        recordingDot.backgroundColor = UIColor(red: 0.96, green: 0.29, blue: 0.27, alpha: 1)
        recordingDot.layer.cornerRadius = 6
        recordingDot.translatesAutoresizingMaskIntoConstraints = false
        phoneCardContainer.addSubview(recordingDot)

        NSLayoutConstraint.activate([
            // Close button
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            closeButton.heightAnchor.constraint(equalToConstant: 36),

            // Title
            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 72),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),

            // Subtitle
            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            subtitleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            subtitleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40),

            // Phone card
            phoneCardContainer.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            phoneCardContainer.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: 10),
            phoneCardContainer.widthAnchor.constraint(equalToConstant: 180),
            phoneCardContainer.heightAnchor.constraint(equalToConstant: 260),

            micIcon.centerXAnchor.constraint(equalTo: phoneCardContainer.centerXAnchor),
            micIcon.centerYAnchor.constraint(equalTo: phoneCardContainer.centerYAnchor, constant: -20),
            micIcon.widthAnchor.constraint(equalToConstant: 64),
            micIcon.heightAnchor.constraint(equalToConstant: 64),

            recordingDot.centerXAnchor.constraint(equalTo: phoneCardContainer.centerXAnchor),
            recordingDot.topAnchor.constraint(equalTo: micIcon.bottomAnchor, constant: 20),
            recordingDot.widthAnchor.constraint(equalToConstant: 12),
            recordingDot.heightAnchor.constraint(equalToConstant: 12),

            // Swipe bar
            swipeBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            swipeBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40),
            swipeBar.heightAnchor.constraint(equalToConstant: 44),
            swipeBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -80),

            swipeHandIcon.centerYAnchor.constraint(equalTo: swipeBar.centerYAnchor),
            swipeHandIcon.leadingAnchor.constraint(equalTo: swipeBar.leadingAnchor, constant: 16),
            swipeHandIcon.widthAnchor.constraint(equalToConstant: 24),
            swipeHandIcon.heightAnchor.constraint(equalToConstant: 24),

            swipeBarLabel.centerYAnchor.constraint(equalTo: swipeBar.centerYAnchor),
            swipeBarLabel.leadingAnchor.constraint(equalTo: swipeHandIcon.trailingAnchor, constant: 10),
            swipeBarLabel.trailingAnchor.constraint(equalTo: swipeBar.trailingAnchor, constant: -16),

            // Status label
            statusLabel.bottomAnchor.constraint(equalTo: swipeBar.topAnchor, constant: -16),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

            // Background mode (bottom-left, subtle)
            backgroundModeSwitch.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -20),
            backgroundModeSwitch.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),

            backgroundModeLabel.centerYAnchor.constraint(equalTo: backgroundModeSwitch.centerYAnchor),
            backgroundModeLabel.leadingAnchor.constraint(equalTo: backgroundModeSwitch.trailingAnchor, constant: 8),
        ])

        closeButton.addTarget(self, action: #selector(cancelAndDismiss), for: .touchUpInside)
        backgroundModeSwitch.addTarget(self, action: #selector(backgroundModeSwitchChanged(_:)), for: .valueChanged)
    }

    // MARK: - Actions

    @objc private func cancelAndDismiss() {
        cleanup()
        writeStatus("idle")
        writeAudioLevel(0)
        dismiss(animated: true)
    }

    @objc private func backgroundModeSwitchChanged(_ sender: UISwitch) {
        applyBackgroundModeEnabled(sender.isOn, source: "app-toggle")
    }

    /// Explicitly start the background-recording lifecycle. Called from
    /// AppDelegate after the controller is parked as a child VC so the engine
    /// runs even before its view appears.
    func startBackgroundEngine() {
        DispatchQueue.main.async {
            guard self.isBackgroundModeEnabled else { return }
            self.startCommandPolling()
            let command = self.defaults?.string(forKey: commandKey) ?? "idle"
            if command == "start" {
                self.writeCommand("idle")
                self.pendingBackgroundStart = true
                self.nextStartRetryAt = .distantPast
                self.attemptPendingBackgroundStart(reason: "startBackgroundEngine")
            } else if self.audioRecorder?.isRecording != true {
                self.ensureStandbyCaptureIfNeeded(reason: "startBackgroundEngine")
            }
        }
    }

    func restartForNewDictationRequest() {
        DispatchQueue.main.async {
            let status = self.defaults?.string(forKey: statusKey) ?? "idle"
            if status == "processing" {
                NSLog("[Recording] Ignoring restart request while transcription is processing")
                return
            }

            if let recorder = self.audioRecorder, recorder.isRecording {
                NSLog("[Recording] Restart requested while already recording; keeping active recording")
                self.statusLabel.text = "🎙️ Recording..."
                self.ensureRecordingStatus()
                return
            }

            NSLog("[Recording] Restarting flow for a new dictation request")
            self.cleanup()
            self.recordingURL = nil
            self.writeResult("")
            self.writeCommand("idle")
            self.writeStatus("idle")
            self.requestMicrophoneAndStartRecording()
        }
    }

    // MARK: - Microphone Permission

    private func requestMicrophoneAndStartRecording() {
        requestMicrophonePermission { [weak self] granted in
            guard let self = self else { return }
            if granted {
                self.startRecordingInBackground()
            } else {
                self.statusLabel.text = "❌ Mic access denied"
                self.writeStatus("error")
            }
        }
    }

    private func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
        NSLog("[Recording] Requesting microphone permission...")
        statusLabel.text = "🎤 Requesting mic access..."

        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            NSLog("[Recording] Mic permission already granted")
            completion(true)
        case .denied:
            NSLog("[Recording] Mic permission denied")
            completion(false)
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    if granted {
                        NSLog("[Recording] Mic permission granted")
                        completion(true)
                    } else {
                        NSLog("[Recording] Mic permission denied by user")
                        completion(false)
                    }
                }
            }
        @unknown default:
            completion(true)
        }
    }

    // MARK: - Background Recording

    private func startRecordingInBackground() {
        if isStartInProgress {
            NSLog("[Recording] Start already in progress; ignoring duplicate request")
            return
        }

        if let recorder = audioRecorder, recorder.isRecording {
            NSLog("[Recording] Recorder already running, reusing active session")
            statusLabel.text = "🎙️ Recording..."
            writeStatus("recording")
            if meteringTimer == nil {
                startMetering()
            }
            if commandTimer == nil {
                startCommandPolling()
            }
            pendingBackgroundStart = false
            nextStartRetryAt = .distantPast
            startRetryBackoff = 0.4
            return
        }

        isStartInProgress = true
        defer { isStartInProgress = false }
        stopStandbyCapture()

        NSLog("[Recording] Setting up audio session...")
        statusLabel.text = "🎙️ Starting recording..."

        let session = AVAudioSession.sharedInstance()
        if !configureAudioSession(session, forceReset: false) {
            handleStartFailure(message: "❌ Audio setup failed")
            return
        }

        if let started = attemptRecorderStart(pass: "initial") {
            activateStartedRecorder(started.recorder, fileURL: started.url, configLabel: started.label)
            return
        }

        // If record() returned false for all configs, force a hard audio-session cycle once.
        guard configureAudioSession(session, forceReset: true) else {
            handleStartFailure(message: "❌ Audio setup failed")
            return
        }

        if let started = attemptRecorderStart(pass: "retry-after-session-reset") {
            activateStartedRecorder(started.recorder, fileURL: started.url, configLabel: started.label)
            return
        }

        handleStartFailure(message: "❌ Mic prepare failed")
    }

    private func attemptRecorderStart(pass: String) -> (recorder: AVAudioRecorder, url: URL, label: String)? {
        let baseName = "overlay_dictation_\(Int(Date().timeIntervalSince1970))"
        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let recorderConfigs = buildRecorderConfigs(baseName: baseName, tempDir: tempDir)
        var failures: [String] = []

        for config in recorderConfigs {
            do {
                try? FileManager.default.removeItem(at: config.url)
                NSLog("[Recording] [\(pass)] Trying recorder config: \(config.label) at \(config.url.lastPathComponent)")
                let recorder = try AVAudioRecorder(url: config.url, settings: config.settings)
                recorder.isMeteringEnabled = true

                let prepared = recorder.prepareToRecord()
                NSLog("[Recording] [\(pass)] \(config.label) prepareToRecord() = \(prepared)")
                if !prepared {
                    failures.append("\(config.label): prepare=false")
                    continue
                }

                let started = recorder.record()
                NSLog("[Recording] [\(pass)] \(config.label) record() = \(started)")
                if !started {
                    failures.append("\(config.label): record=false")
                    continue
                }

                return (recorder, config.url, config.label)
            } catch {
                NSLog("[Recording] [\(pass)] \(config.label) recorder error: \(error)")
                failures.append("\(config.label): \(error.localizedDescription)")
            }
        }

        NSLog("[Recording] [\(pass)] All recorder configs failed: \(failures.joined(separator: " | "))")
        return nil
    }

    private func activateStartedRecorder(_ recorder: AVAudioRecorder, fileURL: URL, configLabel: String) {
        audioRecorder = recorder
        recordingURL = fileURL
        pendingBackgroundStart = false
        nextStartRetryAt = .distantPast
        startRetryBackoff = 0.4
        writeStatus("recording")
        writeCommand("idle")  // Clear any pending command
        startMetering()
        startCommandPolling()
        statusLabel.text = "🎙️ Recording..."
        NSLog("[Recording] ✅ Started recording with \(configLabel) to: \(fileURL.lastPathComponent)")
    }

    private func handleStartFailure(message: String) {
        if isBackgroundModeEnabled && pendingBackgroundStart {
            let retryIn = startRetryBackoff
            nextStartRetryAt = Date().addingTimeInterval(retryIn)
            startRetryBackoff = min(startRetryBackoff * 1.8, 4.0)
            writeStatus("idle")
            statusLabel.text = "⚠️ Mic busy. Retrying..."
            NSLog("[Recording] Start failed in BG mode; retrying in \(String(format: "%.2f", retryIn))s")
            keepListeningForCommandsIfNeeded()
            return
        }

        statusLabel.text = message
        writeStatus("error")
    }

    private func attemptPendingBackgroundStart(reason: String) {
        guard pendingBackgroundStart else { return }
        guard isBackgroundModeEnabled else { return }
        guard !isStartInProgress else { return }
        guard audioRecorder?.isRecording != true else {
            pendingBackgroundStart = false
            nextStartRetryAt = .distantPast
            startRetryBackoff = 0.4
            return
        }

        let now = Date()
        guard now >= nextStartRetryAt else { return }
        NSLog("[Recording] Attempting pending background start (\(reason))")
        requestMicrophoneAndStartRecording()
    }

    // MARK: - Metering (writes audio level to App Group)

    private func startMetering() {
        meteringTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self, let recorder = self.audioRecorder, recorder.isRecording else { return }
            recorder.updateMeters()
            let db = recorder.averagePower(forChannel: 0)
            let level = max(0, min(1, (db + 50) / 50))
            self.ensureRecordingStatus()
            self.writeAudioLevel(level)
        }
    }

    private func stopMetering() {
        meteringTimer?.invalidate()
        meteringTimer = nil
        writeAudioLevel(0)
    }

    // MARK: - Command Polling (listens for stop command from keyboard)

    private func startCommandPolling() {
        commandTimer?.invalidate()
        commandTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self else { return }

            if self.syncBackgroundModeFromSharedDefaultsIfNeeded(source: "shared-defaults") {
                return
            }

            let command = self.defaults?.string(forKey: commandKey) ?? "idle"
            if command == disableBackgroundCommand {
                self.writeCommand("idle")
                self.applyBackgroundModeEnabled(false, source: "keyboard-command")
                return
            } else if command == "start" {
                if self.audioRecorder?.isRecording == true {
                    self.writeCommand("idle")
                    self.pendingBackgroundStart = false
                    self.ensureRecordingStatus()
                    return
                }
                if !self.pendingBackgroundStart {
                    NSLog("[Recording] Received start command from keyboard")
                }
                self.pendingBackgroundStart = true
                self.nextStartRetryAt = .distantPast
                self.attemptPendingBackgroundStart(reason: "command")
            } else if command == "stop" {
                self.writeCommand("idle")
                self.pendingBackgroundStart = false
                self.nextStartRetryAt = .distantPast
                self.startRetryBackoff = 0.4
                guard self.audioRecorder?.isRecording == true else {
                    self.writeStatus("idle")
                    self.ensureStandbyCaptureIfNeeded(reason: "stop-without-recording")
                    return
                }
                NSLog("[Recording] Received stop command from keyboard")
                self.stopAndTranscribe()
            } else if self.audioRecorder?.isRecording == true {
                self.ensureRecordingStatus()
            } else if self.pendingBackgroundStart {
                self.attemptPendingBackgroundStart(reason: "retry-loop")
            } else if self.isBackgroundModeEnabled {
                self.ensureStandbyCaptureIfNeeded(reason: "idle-loop")
            }
        }
    }

    private func stopCommandPolling() {
        commandTimer?.invalidate()
        commandTimer = nil
    }

    // MARK: - Stop and Transcribe

    private func stopAndTranscribe() {
        stopMetering()
        stopCommandPolling()

        guard let recorder = audioRecorder, recorder.isRecording else {
            writeStatus("idle")
            keepListeningForCommandsIfNeeded()
            return
        }

        let duration = recorder.currentTime
        recorder.stop()
        audioRecorder = nil
        NSLog("[Recording] Stopped recording, duration: \(duration)s")

        if !isBackgroundModeEnabled {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            isAudioSessionConfigured = false
        }

        writeStatus("processing")
        statusLabel.text = "⏳ Transcribing..."

        guard let url = recordingURL,
              FileManager.default.fileExists(atPath: url.path) else {
            NSLog("[Recording] Recording file not found")
            writeStatus("error")
            writeResult("")
            keepListeningForCommandsIfNeeded()
            return
        }

        let backendToken = defaults?.string(forKey: authTokenKey)
        let backendBaseURL = defaults?.string(forKey: authBaseURLKey)
        let backendUserId = defaults?.string(forKey: authUserIdKey)
        let groqKey = groqAPIKey
        let hasBackendCreds =
            backendToken?.isEmpty == false &&
            backendBaseURL?.isEmpty == false &&
            backendUserId?.isEmpty == false
        let canTranscribe = hasBackendCreds || (groqKey?.isEmpty == false)
        guard canTranscribe else {
            NSLog("[Recording] No transcription credentials available (no auth token or Groq key)")
            writeStatus("error")
            writeResult("")
            keepListeningForCommandsIfNeeded()
            return
        }

        // Groq requires at least ~0.1s. Keep threshold low so short dictations still go through.
        if duration < 0.1 {
            NSLog("[Recording] Recording too short: \(duration)s")
            writeStatus("error")
            writeResult("")
            try? FileManager.default.removeItem(at: url)
            keepListeningForCommandsIfNeeded()
            return
        }

        Task {
            do {
                let text: String
                if let token = backendToken, !token.isEmpty,
                   let baseURL = backendBaseURL, !baseURL.isEmpty,
                   let userId = backendUserId, !userId.isEmpty {
                    text = try await transcribeViaBackend(url: url, token: token, baseURL: baseURL, userId: userId)
                } else if let key = groqKey, !key.isEmpty {
                    text = try await transcribeWithGroq(url: url, apiKey: key)
                } else {
                    throw NSError(domain: "Overlay", code: -1, userInfo: [NSLocalizedDescriptionKey: "No transcription provider"])
                }
                try? FileManager.default.removeItem(at: url)
                await MainActor.run {
                    let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !normalized.isEmpty else {
                        NSLog("[Recording] Transcription empty result")
                        self.writeStatus("error")
                        self.writeResult("")
                        self.statusLabel.text = "❌ Didn't catch that"
                        self.keepListeningForCommandsIfNeeded()
                        return
                    }

                    NSLog("[Recording] Transcription success: \(normalized)")
                    SharedKeyStore.appendTranscription(normalized)
                    self.writeResult(normalized)
                    self.writeStatus("done")
                    self.statusLabel.text = "✅ Done! Return to keyboard."
                    self.keepListeningForCommandsIfNeeded()
                }
            } catch {
                await MainActor.run {
                    NSLog("[Recording] Transcription error: \(error)")
                    self.writeStatus("error")
                    self.writeResult("")
                    self.statusLabel.text = "❌ Error transcribing"
                    self.keepListeningForCommandsIfNeeded()
                }
                try? FileManager.default.removeItem(at: url)
            }
        }
    }

    private func cleanup() {
        stopMetering()
        stopCommandPolling()
        audioRecorder?.stop()
        audioRecorder = nil
        stopStandbyCapture()
        pendingBackgroundStart = false
        nextStartRetryAt = .distantPast
        startRetryBackoff = 0.4
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        isAudioSessionConfigured = false
    }

    private func applyBackgroundModeEnabled(_ enabled: Bool, source: String) {
        defaults?.set(enabled, forKey: backgroundModeKey)
        defaults?.synchronize()

        if backgroundModeSwitch.isOn != enabled {
            backgroundModeSwitch.setOn(enabled, animated: true)
        }

        if enabled {
            pendingBackgroundStart = false
            nextStartRetryAt = .distantPast
            startRetryBackoff = 0.4
            writeCommand("idle")
            startCommandPolling()
            requestMicrophonePermission { [weak self] granted in
                guard let self = self else { return }
                if granted {
                    if self.audioRecorder?.isRecording != true {
                        self.statusLabel.text = "🟢 Background mic mode is on"
                    }
                    self.ensureStandbyCaptureIfNeeded(reason: "enable-\(source)")
                    NSLog("[Recording] Background mic mode enabled (\(source))")
                } else {
                    self.statusLabel.text = "❌ Mic access denied"
                    self.writeStatus("error")
                    NSLog("[Recording] Background mic enable failed (\(source)): no mic permission")
                }
            }
            return
        }

        pendingBackgroundStart = false
        nextStartRetryAt = .distantPast
        startRetryBackoff = 0.4
        writeCommand("idle")
        stopMetering()
        stopStandbyCapture()

        if let recorder = audioRecorder, recorder.isRecording {
            recorder.stop()
            audioRecorder = nil
            NSLog("[Recording] Active recording stopped while disabling BG mode (\(source))")
        } else {
            audioRecorder = nil
        }

        recordingURL = nil
        stopCommandPolling()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        isAudioSessionConfigured = false
        writeStatus("idle")
        writeAudioLevel(0)
        statusLabel.text = "⚪️ Background mic mode is off"
        NSLog("[Recording] Background mic mode disabled (\(source))")
    }

    @discardableResult
    private func syncBackgroundModeFromSharedDefaultsIfNeeded(source: String) -> Bool {
        guard let defaults = defaults else { return false }
        guard defaults.object(forKey: backgroundModeKey) != nil else { return false }
        let sharedEnabled = defaults.bool(forKey: backgroundModeKey)
        guard sharedEnabled != backgroundModeSwitch.isOn else { return false }
        applyBackgroundModeEnabled(sharedEnabled, source: source)
        return true
    }

    // MARK: - App Group

    private func writeStatus(_ status: String) {
        defaults?.set(status, forKey: statusKey)
        if status == "recording" {
            defaults?.set(Date().timeIntervalSince1970, forKey: recordingHeartbeatKey)
        }
        defaults?.synchronize()
    }

    private func writeAudioLevel(_ level: Float) {
        defaults?.set(level, forKey: audioLevelKey)
        defaults?.set(Date().timeIntervalSince1970, forKey: recordingHeartbeatKey)
    }

    private func writeCommand(_ command: String) {
        defaults?.set(command, forKey: commandKey)
        defaults?.synchronize()
    }

    private func writeResult(_ text: String) {
        defaults?.set(text, forKey: resultKey)
        defaults?.synchronize()
    }

    private func ensureRecordingStatus() {
        guard defaults?.string(forKey: statusKey) != "recording" else { return }
        defaults?.set("recording", forKey: statusKey)
        defaults?.set(Date().timeIntervalSince1970, forKey: recordingHeartbeatKey)
    }

    private func keepListeningForCommandsIfNeeded() {
        guard isBackgroundModeEnabled else { return }
        writeCommand("idle")
        startCommandPolling()
        ensureStandbyCaptureIfNeeded(reason: "keep-listening")
    }

    private func configureAudioSession(_ session: AVAudioSession, forceReset: Bool) -> Bool {
        if isAudioSessionConfigured && !forceReset {
            do {
                try session.setActive(true)
                NSLog("[Recording] Audio session reused from previous recording")
                return true
            } catch {
                let err = error as NSError
                NSLog("[Recording] Existing audio session reactivation failed: \(err.domain) (\(err.code)) \(err.localizedDescription)")
                isAudioSessionConfigured = false
            }
        }

        if isAudioSessionConfigured || forceReset {
            do {
                try session.setActive(false, options: .notifyOthersOnDeactivation)
                NSLog("[Recording] Audio session deactivated before reconfiguration")
            } catch {
                let err = error as NSError
                NSLog("[Recording] Audio session pre-reset failed: \(err.domain) (\(err.code)) \(err.localizedDescription)")
            }
            isAudioSessionConfigured = false
        }

        let candidates: [(label: String, category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)] = [
            ("playAndRecord/voiceChat/mix", .playAndRecord, .voiceChat, [.mixWithOthers, .allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]),
            ("record/measurement/mix", .record, .measurement, [.mixWithOthers]),
            ("playAndRecord/default/mix", .playAndRecord, .default, [.mixWithOthers, .allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]),
            ("record/default", .record, .default, []),
            ("playAndRecord/measurement", .playAndRecord, .measurement, [.allowBluetooth])
        ]

        var failures: [String] = []
        for candidate in candidates {
            do {
                try session.setCategory(candidate.category, mode: candidate.mode, options: candidate.options)
                try session.setActive(true)
                isAudioSessionConfigured = true
                NSLog("[Recording] Audio session configured using \(candidate.label)")
                return true
            } catch {
                let err = error as NSError
                failures.append("\(candidate.label): \(err.domain) (\(err.code)) \(err.localizedDescription)")
                if shouldRetryImmediatelyForAudioError(err) {
                    do {
                        try session.setActive(false, options: .notifyOthersOnDeactivation)
                    } catch { }
                    Thread.sleep(forTimeInterval: 0.08)
                }
            }
        }

        NSLog("[Recording] Audio session error: \(failures.joined(separator: " | "))")
        return false
    }

    private func shouldRetryImmediatelyForAudioError(_ error: NSError) -> Bool {
        guard error.domain == NSOSStatusErrorDomain else { return false }
        return error.code == 561015905 || error.code == 560557684 || error.code == 561017449
    }

    private func ensureStandbyCaptureIfNeeded(reason: String) {
        guard isBackgroundModeEnabled else {
            stopStandbyCapture()
            return
        }
        guard audioRecorder?.isRecording != true else { return }
        guard !pendingBackgroundStart else { return }
        guard !isStartInProgress else { return }

        if isStandbyCaptureActive && (standbyRecorder?.isRecording == true) {
            return
        }

        let now = Date()
        if now.timeIntervalSince(lastStandbyAttemptAt) < 1.0 {
            return
        }
        lastStandbyAttemptAt = now
        startStandbyCapture(reason: reason)
    }

    private func startStandbyCapture(reason: String) {
        let session = AVAudioSession.sharedInstance()
        guard configureAudioSession(session, forceReset: false) else {
            NSLog("[Recording] Standby capture skipped; audio session unavailable (\(reason))")
            return
        }

        if let recorder = standbyRecorder, recorder.isRecording {
            isStandbyCaptureActive = true
            return
        }

        let tempDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let fileURL = tempDir.appendingPathComponent("overlay_bg_standby.m4a")
        standbyRecordingURL = fileURL

        do {
            // Keep file size bounded during long-running standby mode.
            if let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
               let size = attrs[.size] as? NSNumber,
               size.int64Value > 5_000_000 {
                try? FileManager.default.removeItem(at: fileURL)
            }

            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 16000.0,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.low.rawValue,
                AVEncoderBitRateKey: 12000
            ]

            let recorder = try AVAudioRecorder(url: fileURL, settings: settings)
            recorder.isMeteringEnabled = false
            let prepared = recorder.prepareToRecord()
            let started = prepared ? recorder.record() : false
            guard prepared && started else {
                throw NSError(domain: "Recording", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: "Standby recorder failed (prepared=\(prepared), started=\(started))"
                ])
            }

            standbyRecorder = recorder
            isStandbyCaptureActive = true
            writeStatus("idle")
            writeAudioLevel(0)
            NSLog("[Recording] Standby capture active (\(reason))")
        } catch {
            isStandbyCaptureActive = false
            standbyRecorder = nil
            NSLog("[Recording] Standby capture start failed (\(reason)): \(error)")
        }
    }

    private func stopStandbyCapture() {
        standbyRecorder?.stop()
        standbyRecorder = nil
        isStandbyCaptureActive = false
        if let standbyRecordingURL {
            try? FileManager.default.removeItem(at: standbyRecordingURL)
        }
        standbyRecordingURL = nil
    }

    private func registerLifecycleObservers() {
        let center = NotificationCenter.default

        notificationTokens.append(center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self, self.isBackgroundModeEnabled else { return }
            self.startCommandPolling()
            self.ensureStandbyCaptureIfNeeded(reason: "didEnterBackground")
        })

        notificationTokens.append(center.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            if self.isBackgroundModeEnabled {
                self.startCommandPolling()
                self.ensureStandbyCaptureIfNeeded(reason: "willEnterForeground")
            }
        })

        notificationTokens.append(center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleAudioInterruption(note)
        })

        notificationTokens.append(center.addObserver(
            forName: AVAudioSession.mediaServicesWereResetNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self = self else { return }
            self.isAudioSessionConfigured = false
            self.stopStandbyCapture()
            if self.isBackgroundModeEnabled {
                self.ensureStandbyCaptureIfNeeded(reason: "mediaServicesReset")
            }
        })

        notificationTokens.append(center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.handleAudioRouteChange(note)
        })
    }

    private func unregisterLifecycleObservers() {
        let center = NotificationCenter.default
        for token in notificationTokens {
            center.removeObserver(token)
        }
        notificationTokens.removeAll()
    }

    private func handleAudioInterruption(_ note: Notification) {
        guard
            let userInfo = note.userInfo,
            let rawType = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: rawType)
        else {
            return
        }

        if type == .began {
            NSLog("[Recording] Audio interruption began")
            if audioRecorder?.isRecording == true {
                audioRecorder?.stop()
                audioRecorder = nil
                stopMetering()
            }
            stopStandbyCapture()
            isAudioSessionConfigured = false
            return
        }

        NSLog("[Recording] Audio interruption ended")
        guard isBackgroundModeEnabled else { return }
        if pendingBackgroundStart {
            nextStartRetryAt = .distantPast
            attemptPendingBackgroundStart(reason: "interruption-ended")
        } else {
            ensureStandbyCaptureIfNeeded(reason: "interruption-ended")
        }
    }

    private func handleAudioRouteChange(_ note: Notification) {
        guard isBackgroundModeEnabled else { return }
        if audioRecorder?.isRecording == true { return }
        guard
            let info = note.userInfo,
            let rawReason = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
            let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason)
        else {
            ensureStandbyCaptureIfNeeded(reason: "routeChange-unknown")
            return
        }

        switch reason {
        case .oldDeviceUnavailable, .newDeviceAvailable, .routeConfigurationChange, .categoryChange, .override:
            ensureStandbyCaptureIfNeeded(reason: "routeChange-\(reason.rawValue)")
        default:
            break
        }
    }

    private func logAppGroupDiagnostics() {
        let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
        if let containerURL {
            NSLog("[Recording] App Group container: \(containerURL.path)")
        } else {
            NSLog("[Recording] App Group container unavailable for id: \(appGroupID)")
        }

        if defaults == nil {
            NSLog("[Recording] UserDefaults suite unavailable for app group id: \(appGroupID)")
        }

        NSLog("[Recording] Background mic mode default: \(isBackgroundModeEnabled)")
    }

    private func buildRecorderConfigs(baseName: String, tempDir: URL) -> [(label: String, url: URL, settings: [String: Any])] {
        let aac44 = (
            label: "AAC-44k-m4a",
            url: tempDir.appendingPathComponent("\(baseName).m4a"),
            settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44100.0,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
                AVEncoderBitRateKey: 64000
            ] as [String: Any]
        )

        let aac22 = (
            label: "AAC-22k-m4a",
            url: tempDir.appendingPathComponent("\(baseName)_22k.m4a"),
            settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 22050.0,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
                AVEncoderBitRateKey: 48000
            ] as [String: Any]
        )

        let wav16 = (
            label: "PCM-16k-wav",
            url: tempDir.appendingPathComponent("\(baseName).wav"),
            settings: [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 16000.0,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false
            ] as [String: Any]
        )

        return [aac44, aac22, wav16]
    }

    // MARK: - Backend transcription

    /// POST audio to the Overlay backend's authenticated transcription
    /// endpoint. The endpoint mirrors Groq's API and returns `{ text: ... }`.
    private func transcribeViaBackend(url: URL, token: String, baseURL: String, userId: String) async throws -> String {
        let normalizedBase = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        // resolveAuthenticatedAppUser requires both Bearer and a userId query param.
        let encodedUid = userId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? userId
        guard let endpoint = URL(string: "\(normalizedBase)/api/v1/transcribe?userId=\(encodedUid)") else {
            throw NSError(domain: "OverlayBackend", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid base URL: \(baseURL)"])
        }

        let audioData = try Data(contentsOf: url)
        NSLog("[Backend] Audio file size: \(audioData.count) bytes; endpoint=\(endpoint.absoluteString)")

        let boundary = UUID().uuidString
        var body = Data()
        func append(_ string: String) { body.append(string.data(using: .utf8)!) }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"audio\"; filename=\"audio.\(url.pathExtension.lowercased())\"\r\n")
        append("Content-Type: \(mimeType(for: url))\r\n\r\n")
        body.append(audioData)
        append("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        request.timeoutInterval = 60

        let (data, response) = try await URLSession.shared.data(for: request)
        let responseStr = String(data: data, encoding: .utf8) ?? ""

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            NSLog("[Backend] Transcription error \(String(describing: (response as? HTTPURLResponse)?.statusCode)): \(responseStr)")
            throw NSError(
                domain: "OverlayBackend",
                code: (response as? HTTPURLResponse)?.statusCode ?? 0,
                userInfo: [NSLocalizedDescriptionKey: responseStr]
            )
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (json?["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    // MARK: - Groq API (legacy fallback)

    private func transcribeWithGroq(url: URL, apiKey: String) async throws -> String {
        let audioData = try Data(contentsOf: url)
        NSLog("[Groq] Audio file size: \(audioData.count) bytes")

        let boundary = UUID().uuidString
        var body = Data()

        func append(_ string: String) {
            body.append(string.data(using: .utf8)!)
        }

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"model\"\r\n\r\n")
        append("whisper-large-v3-turbo\r\n")

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"response_format\"\r\n\r\n")
        append("json\r\n")

        append("--\(boundary)\r\n")
        append("Content-Disposition: form-data; name=\"file\"; filename=\"audio.\(url.pathExtension.lowercased())\"\r\n")
        append("Content-Type: \(mimeType(for: url))\r\n\r\n")
        body.append(audioData)
        append("\r\n--\(boundary)--\r\n")

        var request = URLRequest(url: URL(string: "https://api.groq.com/openai/v1/audio/transcriptions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        request.timeoutInterval = 60

        let (data, response) = try await URLSession.shared.data(for: request)
        let responseStr = String(data: data, encoding: .utf8) ?? ""
        NSLog("[Groq] Response: \(responseStr)")

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw NSError(domain: "Groq", code: (response as? HTTPURLResponse)?.statusCode ?? 0,
                          userInfo: [NSLocalizedDescriptionKey: responseStr])
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (json?["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "m4a":
            return "audio/mp4"
        case "wav":
            return "audio/wav"
        case "caf":
            return "audio/x-caf"
        default:
            return "application/octet-stream"
        }
    }
}
