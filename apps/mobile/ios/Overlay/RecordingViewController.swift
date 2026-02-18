import UIKit
import AVFoundation

private let appGroupID = "group.com.layernorm.overlay-mobile"
private let statusKey = "overlay_kb_status"
private let resultKey = "overlay_kb_result"
private let audioLevelKey = "overlay_kb_audio_level"
private let commandKey = "overlay_kb_command"
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
    private var meteringTimer: Timer?
    private var commandTimer: Timer?
    private var recordingURL: URL?

    private var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    private var groqAPIKey: String? {
        defaults?.string(forKey: groqKeyName)
    }

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        requestMicrophoneAndStartRecording()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        // Don't stop recording when view disappears - keep recording in background
    }

    deinit {
        cleanup()
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.addSubview(closeButton)
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

    // MARK: - Microphone Permission

    private func requestMicrophoneAndStartRecording() {
        NSLog("[Recording] Requesting microphone permission...")
        statusLabel.text = "🎤 Requesting mic access..."
        
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            NSLog("[Recording] Mic permission already granted")
            startRecordingInBackground()
        case .denied:
            NSLog("[Recording] Mic permission denied")
            statusLabel.text = "❌ Mic access denied. Enable in Settings."
            writeStatus("error")
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        NSLog("[Recording] Mic permission granted")
                        self?.startRecordingInBackground()
                    } else {
                        NSLog("[Recording] Mic permission denied by user")
                        self?.statusLabel.text = "❌ Mic access denied"
                        self?.writeStatus("error")
                    }
                }
            }
        @unknown default:
            startRecordingInBackground()
        }
    }

    // MARK: - Background Recording

    private func startRecordingInBackground() {
        NSLog("[Recording] Setting up audio session...")
        statusLabel.text = "🎙️ Starting recording..."
        
        let session = AVAudioSession.sharedInstance()
        do {
            // Use playAndRecord to allow background audio
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            NSLog("[Recording] Audio session configured successfully")
        } catch {
            NSLog("[Recording] Audio session error: \(error)")
            statusLabel.text = "❌ Audio setup failed"
            writeStatus("error")
            return
        }

        let fileURL = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("overlay_dictation_\(Int(Date().timeIntervalSince1970)).m4a")
        recordingURL = fileURL

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000.0,  // Groq recommends 16kHz
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            AVEncoderBitRateKey: 64000
        ]

        do {
            NSLog("[Recording] Creating recorder at: \(fileURL.path)")
            let recorder = try AVAudioRecorder(url: fileURL, settings: settings)
            recorder.isMeteringEnabled = true
            
            let prepared = recorder.prepareToRecord()
            NSLog("[Recording] prepareToRecord() = \(prepared)")
            
            if !prepared {
                NSLog("[Recording] prepareToRecord failed")
                statusLabel.text = "❌ Prepare failed"
                writeStatus("error")
                return
            }
            
            let started = recorder.record()
            NSLog("[Recording] record() = \(started)")
            
            if !started {
                NSLog("[Recording] record() returned false")
                statusLabel.text = "❌ Record start failed"
                writeStatus("error")
                return
            }
            
            audioRecorder = recorder
            writeStatus("recording")
            writeCommand("idle")  // Clear any pending command
            startMetering()
            startCommandPolling()
            
            // Update UI to show recording state
            statusLabel.text = "🎙️ Recording..."
            NSLog("[Recording] ✅ Started recording to: \(fileURL.lastPathComponent)")
        } catch {
            NSLog("[Recording] Recorder error: \(error)")
            statusLabel.text = "❌ Recorder error: \(error.localizedDescription)"
            writeStatus("error")
        }
    }

    // MARK: - Metering (writes audio level to App Group)

    private func startMetering() {
        meteringTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self, let recorder = self.audioRecorder, recorder.isRecording else { return }
            recorder.updateMeters()
            let db = recorder.averagePower(forChannel: 0)
            let level = max(0, min(1, (db + 50) / 50))
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
        commandTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let command = self.defaults?.string(forKey: commandKey) ?? "idle"
            if command == "stop" {
                NSLog("[Recording] Received stop command from keyboard")
                self.stopAndTranscribe()
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
            return
        }

        let duration = recorder.currentTime
        recorder.stop()
        audioRecorder = nil
        NSLog("[Recording] Stopped recording, duration: \(duration)s")

        writeStatus("processing")
        statusLabel.text = "⏳ Transcribing..."

        guard let url = recordingURL,
              FileManager.default.fileExists(atPath: url.path) else {
            NSLog("[Recording] Recording file not found")
            writeStatus("error")
            writeResult("")
            return
        }

        guard let key = groqAPIKey, !key.isEmpty else {
            NSLog("[Recording] No API key")
            writeStatus("error")
            writeResult("")
            return
        }

        // Check minimum duration (Groq requires at least 0.1s, bills minimum 10s)
        if duration < 0.5 {
            NSLog("[Recording] Recording too short: \(duration)s")
            writeStatus("error")
            writeResult("")
            try? FileManager.default.removeItem(at: url)
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
                }
            } catch {
                await MainActor.run {
                    NSLog("[Recording] Transcription error: \(error)")
                    self.writeStatus("error")
                    self.writeResult("")
                    self.statusLabel.text = "❌ Error transcribing"
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
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
    }

    private func writeResult(_ text: String) {
        defaults?.set(text, forKey: resultKey)
        defaults?.synchronize()
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
        append("Content-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\n")
        append("Content-Type: audio/mp4\r\n\r\n")
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
}
