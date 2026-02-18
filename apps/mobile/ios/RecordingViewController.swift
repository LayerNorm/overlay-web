import UIKit
import AVFoundation

private let appGroupID = "group.com.layernorm.overlay-mobile"
private let statusKey = "overlay_kb_status"
private let resultKey = "overlay_kb_result"
private let audioLevelKey = "overlay_kb_audio_level"
private let commandKey = "overlay_kb_command"
private let backgroundModeKey = "overlay_kb_background_mode_enabled"
private let groqKeyName = "groq_api_key"

class RecordingViewController: UIViewController {

    // MARK: - UI (Swipe Back Screen)
    private let titleLabel: UILabel = {
        let l = UILabel()
        l.text = "Swipe back to continue"
        l.textColor = .white
        l.font = .systemFont(ofSize: 28, weight: .bold)
        l.textAlignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let subtitleLabel: UILabel = {
        let l = UILabel()
        l.text = "We'd love for you to use Overlay directly,\nbut iOS requires switching apps to\nturn on the microphone."
        l.textColor = UIColor(white: 0.6, alpha: 1)
        l.font = .systemFont(ofSize: 16)
        l.textAlignment = .center
        l.numberOfLines = 0
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let closeButton: UIButton = {
        let b = UIButton(type: .system)
        let config = UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)
        b.setImage(UIImage(systemName: "xmark", withConfiguration: config), for: .normal)
        b.tintColor = UIColor(white: 0.6, alpha: 1)
        b.translatesAutoresizingMaskIntoConstraints = false
        return b
    }()

    private let backgroundModeLabel: UILabel = {
        let l = UILabel()
        l.text = "BG mic"
        l.textColor = UIColor(white: 0.7, alpha: 1)
        l.font = .systemFont(ofSize: 12, weight: .semibold)
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    private let backgroundModeSwitch: UISwitch = {
        let s = UISwitch()
        s.onTintColor = UIColor(red: 0.3, green: 0.9, blue: 0.5, alpha: 1)
        s.translatesAutoresizingMaskIntoConstraints = false
        return s
    }()

    private let phoneIconsContainer: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }()

    private let statusLabel: UILabel = {
        let l = UILabel()
        l.text = "🎙️ Recording..."
        l.textColor = UIColor(red: 0.3, green: 0.9, blue: 0.5, alpha: 1)
        l.font = .systemFont(ofSize: 15, weight: .medium)
        l.textAlignment = .center
        l.translatesAutoresizingMaskIntoConstraints = false
        return l
    }()

    // MARK: - State
    private var audioRecorder: AVAudioRecorder?
    private let standbyEngine = AVAudioEngine()
    private var isStandbyCaptureActive = false
    private var hasInstalledStandbyTap = false
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
        view.backgroundColor = .black
        setupUI()
        backgroundModeSwitch.isOn = isBackgroundModeEnabled
        registerLifecycleObservers()
        logAppGroupDiagnostics()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
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
        view.addSubview(backgroundModeSwitch)
        view.addSubview(backgroundModeLabel)
        view.addSubview(titleLabel)
        view.addSubview(subtitleLabel)
        view.addSubview(phoneIconsContainer)
        view.addSubview(statusLabel)

        // Draw two phone outlines
        let phone1 = createPhoneOutline()
        let phone2 = createPhoneOutline()
        phone2.layer.borderWidth = 2
        phoneIconsContainer.addSubview(phone1)
        phoneIconsContainer.addSubview(phone2)

        // Add mic indicator to phone2
        let micDot = UIView()
        micDot.backgroundColor = UIColor(red: 0.3, green: 0.9, blue: 0.5, alpha: 1)
        micDot.layer.cornerRadius = 8
        micDot.translatesAutoresizingMaskIntoConstraints = false
        phone2.addSubview(micDot)

        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16),
            closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            closeButton.widthAnchor.constraint(equalToConstant: 32),
            closeButton.heightAnchor.constraint(equalToConstant: 32),

            backgroundModeSwitch.centerYAnchor.constraint(equalTo: closeButton.centerYAnchor),
            backgroundModeSwitch.trailingAnchor.constraint(equalTo: closeButton.leadingAnchor, constant: -10),

            backgroundModeLabel.centerYAnchor.constraint(equalTo: backgroundModeSwitch.centerYAnchor),
            backgroundModeLabel.trailingAnchor.constraint(equalTo: backgroundModeSwitch.leadingAnchor, constant: -8),

            titleLabel.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 80),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            subtitleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            subtitleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),

            phoneIconsContainer.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            phoneIconsContainer.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: 40),
            phoneIconsContainer.widthAnchor.constraint(equalToConstant: 200),
            phoneIconsContainer.heightAnchor.constraint(equalToConstant: 160),

            phone1.leadingAnchor.constraint(equalTo: phoneIconsContainer.leadingAnchor),
            phone1.centerYAnchor.constraint(equalTo: phoneIconsContainer.centerYAnchor),
            phone1.widthAnchor.constraint(equalToConstant: 70),
            phone1.heightAnchor.constraint(equalToConstant: 140),

            phone2.trailingAnchor.constraint(equalTo: phoneIconsContainer.trailingAnchor),
            phone2.centerYAnchor.constraint(equalTo: phoneIconsContainer.centerYAnchor),
            phone2.widthAnchor.constraint(equalToConstant: 90),
            phone2.heightAnchor.constraint(equalToConstant: 160),

            micDot.centerXAnchor.constraint(equalTo: phone2.centerXAnchor),
            micDot.bottomAnchor.constraint(equalTo: phone2.bottomAnchor, constant: -30),
            micDot.widthAnchor.constraint(equalToConstant: 16),
            micDot.heightAnchor.constraint(equalToConstant: 16),

            statusLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -60),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
        ])

        closeButton.addTarget(self, action: #selector(cancelAndDismiss), for: .touchUpInside)
        backgroundModeSwitch.addTarget(self, action: #selector(backgroundModeSwitchChanged(_:)), for: .valueChanged)
    }

    private func createPhoneOutline() -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        v.layer.borderColor = UIColor(white: 0.3, alpha: 1).cgColor
        v.layer.borderWidth = 1.5
        v.layer.cornerRadius = 12
        v.translatesAutoresizingMaskIntoConstraints = false
        return v
    }

    // MARK: - Actions

    @objc private func cancelAndDismiss() {
        cleanup()
        writeStatus("idle")
        writeAudioLevel(0)
        dismiss(animated: true)
    }

    @objc private func backgroundModeSwitchChanged(_ sender: UISwitch) {
        defaults?.set(sender.isOn, forKey: backgroundModeKey)
        defaults?.synchronize()

        if sender.isOn {
            writeCommand("idle")
            pendingBackgroundStart = false
            nextStartRetryAt = .distantPast
            startRetryBackoff = 0.4
            startCommandPolling()
            requestMicrophonePermission { [weak self] granted in
                guard let self = self else { return }
                if granted {
                    if self.audioRecorder?.isRecording != true {
                        self.statusLabel.text = "🟢 Background mic mode is on"
                    }
                    self.ensureStandbyCaptureIfNeeded(reason: "toggle-on")
                    NSLog("[Recording] Background mic mode enabled")
                } else {
                    self.statusLabel.text = "❌ Mic access denied"
                    self.writeStatus("error")
                    NSLog("[Recording] Background mic enable failed: no mic permission")
                }
            }
            return
        }

        pendingBackgroundStart = false
        nextStartRetryAt = .distantPast
        startRetryBackoff = 0.4
        stopStandbyCapture()

        if audioRecorder?.isRecording != true {
            stopCommandPolling()
            writeCommand("idle")
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            isAudioSessionConfigured = false
            writeStatus("idle")
        }
        NSLog("[Recording] Background mic mode disabled")
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
            let command = self.defaults?.string(forKey: commandKey) ?? "idle"
            if command == "start" {
                self.writeCommand("idle")
                if self.audioRecorder?.isRecording == true {
                    self.pendingBackgroundStart = false
                    self.ensureRecordingStatus()
                    return
                }
                NSLog("[Recording] Received start command from keyboard")
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

        guard let key = groqAPIKey, !key.isEmpty else {
            NSLog("[Recording] No API key")
            writeStatus("error")
            writeResult("")
            keepListeningForCommandsIfNeeded()
            return
        }

        // Check minimum duration (Groq requires at least 0.1s, bills minimum 10s)
        if duration < 0.5 {
            NSLog("[Recording] Recording too short: \(duration)s")
            writeStatus("error")
            writeResult("")
            try? FileManager.default.removeItem(at: url)
            keepListeningForCommandsIfNeeded()
            return
        }

        Task {
            do {
                let text = try await transcribeWithGroq(url: url, apiKey: key)
                try? FileManager.default.removeItem(at: url)
                await MainActor.run {
                    NSLog("[Recording] Transcription success: \(text)")
                    self.writeResult(text)
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

    // MARK: - App Group

    private func writeStatus(_ status: String) {
        defaults?.set(status, forKey: statusKey)
        defaults?.synchronize()
    }

    private func writeAudioLevel(_ level: Float) {
        defaults?.set(level, forKey: audioLevelKey)
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
            ("playAndRecord/default", .playAndRecord, .default, [.allowBluetoothHFP, .duckOthers]),
            ("record/default", .record, .default, []),
            ("playAndRecord/measurement", .playAndRecord, .measurement, [.allowBluetoothHFP])
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
            }
        }

        NSLog("[Recording] Audio session error: \(failures.joined(separator: " | "))")
        return false
    }

    private func ensureStandbyCaptureIfNeeded(reason: String) {
        guard isBackgroundModeEnabled else {
            stopStandbyCapture()
            return
        }
        guard audioRecorder?.isRecording != true else { return }
        guard !pendingBackgroundStart else { return }
        guard !isStartInProgress else { return }

        if isStandbyCaptureActive && standbyEngine.isRunning {
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

        let inputNode = standbyEngine.inputNode
        let format = inputNode.inputFormat(forBus: 0)
        if hasInstalledStandbyTap {
            inputNode.removeTap(onBus: 0)
            hasInstalledStandbyTap = false
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { _, _ in
            // Keep input route active to avoid background suspension when BG mode is enabled.
        }
        hasInstalledStandbyTap = true

        standbyEngine.prepare()
        do {
            try standbyEngine.start()
            isStandbyCaptureActive = true
            writeStatus("idle")
            writeAudioLevel(0)
            NSLog("[Recording] Standby capture active (\(reason))")
        } catch {
            isStandbyCaptureActive = false
            if hasInstalledStandbyTap {
                inputNode.removeTap(onBus: 0)
                hasInstalledStandbyTap = false
            }
            NSLog("[Recording] Standby capture start failed (\(reason)): \(error)")
        }
    }

    private func stopStandbyCapture() {
        if hasInstalledStandbyTap {
            standbyEngine.inputNode.removeTap(onBus: 0)
            hasInstalledStandbyTap = false
        }
        if standbyEngine.isRunning {
            standbyEngine.stop()
        }
        isStandbyCaptureActive = false
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

    // MARK: - Groq API

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
