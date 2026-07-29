import AVFoundation
import AudioToolbox
import CoreAudio
import Darwin
import Foundation

private let protocolVersion = 1
private let outputLock = NSLock()

private func writeJSON(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8)
    else {
        return
    }
    outputLock.lock()
    print(line)
    fflush(stdout)
    outputLock.unlock()
}

private func errorCode(_ error: Error) -> String {
    let nsError = error as NSError
    return "\(nsError.domain):\(nsError.code)"
}

private func audioProperty<T>(
    objectID: AudioObjectID,
    selector: AudioObjectPropertySelector,
    scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> T? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain
    )
    var size = UInt32(MemoryLayout<T>.size)
    let value = UnsafeMutablePointer<T>.allocate(capacity: 1)
    defer { value.deallocate() }
    guard AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, value) == noErr else {
        return nil
    }
    return value.pointee
}

private func defaultInputRunningSomewhere() -> Bool? {
    guard let deviceID: AudioDeviceID = audioProperty(
        objectID: AudioObjectID(kAudioObjectSystemObject),
        selector: kAudioHardwarePropertyDefaultInputDevice
    ), deviceID != kAudioObjectUnknown,
    let running: UInt32 = audioProperty(
        objectID: deviceID,
        selector: kAudioDevicePropertyDeviceIsRunningSomewhere
    ) else {
        return nil
    }
    return running != 0
}

private func audioStringProperty(
    objectID: AudioObjectID,
    selector: AudioObjectPropertySelector
) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let status = withUnsafeMutableBytes(of: &value) { bytes in
        AudioObjectGetPropertyData(objectID, &address, 0, nil, &size, bytes.baseAddress!)
    }
    guard status == noErr else {
        return nil
    }
    return value as String
}

private func inputDeviceIDs() -> [AudioDeviceID] {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size
    ) == noErr else {
        return []
    }
    var devices = [AudioDeviceID](
        repeating: kAudioObjectUnknown,
        count: Int(size) / MemoryLayout<AudioDeviceID>.size
    )
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size,
        &devices
    ) == noErr else {
        return []
    }
    return devices.filter { deviceID in
        var streamsAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain
        )
        var streamsSize: UInt32 = 0
        return AudioObjectGetPropertyDataSize(
            deviceID,
            &streamsAddress,
            0,
            nil,
            &streamsSize
        ) == noErr && streamsSize > 0
    }
}

private func normalizedDeviceName(_ value: String) -> String {
    value
        .lowercased()
        .replacingOccurrences(of: "(default)", with: "")
        .replacingOccurrences(of: "(built-in)", with: "")
        .replacingOccurrences(of: "microphone", with: "mic")
        .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        .joined(separator: " ")
}

private func inputDeviceID(matching label: String?) -> AudioDeviceID? {
    guard let label, !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return audioProperty(
            objectID: AudioObjectID(kAudioObjectSystemObject),
            selector: kAudioHardwarePropertyDefaultInputDevice
        )
    }
    let requested = normalizedDeviceName(label)
    let candidates = inputDeviceIDs().compactMap { deviceID -> (AudioDeviceID, String)? in
        guard let name = audioStringProperty(
            objectID: deviceID,
            selector: kAudioObjectPropertyName
        ) else {
            return nil
        }
        return (deviceID, normalizedDeviceName(name))
    }
    return candidates.first(where: { $0.1 == requested })?.0
        ?? candidates.first(where: {
            requested.contains($0.1) || $0.1.contains(requested)
        })?.0
}

private final class NativeAudioEngine {
    private let queue = DispatchQueue(label: "com.layernorm.overlay.native-audio")
    private let captureLock = NSLock()
    private let outputDirectory: URL
    private let engine = AVAudioEngine()
    private var graphPrepared = false
    private var tapInstalled = false
    private var captureFile: AVAudioFile?
    private var outputURL: URL?
    private let outputSampleRate = 16_000.0
    private var outputFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var capturedFrames: UInt64 = 0
    private var recordingStartedAtNs: UInt64?
    private var firstAudioReported = false
    private var paused = false
    private var lastLevelSentAtNs: UInt64 = 0
    private var deviceListenerInstalled = false
    private var requestedDeviceLabel: String?
    private var selectedDeviceID: AudioDeviceID = kAudioObjectUnknown

    init(outputDirectory: URL) {
        self.outputDirectory = outputDirectory
    }

    func initialize() {
        queue.async {
            do {
                try FileManager.default.createDirectory(
                    at: self.outputDirectory,
                    withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700]
                )
                try self.removeAbandonedRecordings()
                let prepared = try self.prepareGraphIfAuthorized()
                self.installDeviceListener()
                writeJSON([
                    "type": "ready",
                    "protocolVersion": protocolVersion,
                    "prepared": prepared,
                    "authorization": self.authorizationName(),
                    "inputRunning": defaultInputRunningSomewhere() ?? false
                ])
            } catch {
                writeJSON([
                    "type": "ready",
                    "protocolVersion": protocolVersion,
                    "prepared": false,
                    "authorization": self.authorizationName(),
                    "inputRunning": defaultInputRunningSomewhere() ?? false,
                    "error": errorCode(error)
                ])
            }
        }
    }

    func handle(line: String) {
        queue.async {
            guard let data = line.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let command = object["command"] as? String,
                  let id = object["id"] as? String
            else {
                writeJSON(["type": "protocol-error", "error": "invalid_command"])
                return
            }
            switch command {
            case "configure":
                self.configure(id: id, deviceLabel: object["deviceLabel"] as? String)
            case "start":
                self.start(id: id, deviceLabel: object["deviceLabel"] as? String)
            case "stop": self.stop(id: id)
            case "cancel": self.cancel(id: id)
            case "pause": self.pause(id: id)
            case "resume": self.resume(id: id)
            case "status": self.status(id: id)
            case "shutdown": self.shutdown(id: id)
            default: self.respond(id: id, ok: false, error: "unsupported_command")
            }
        }
    }

    func parentDisconnected() {
        queue.async {
            self.endCapture(deleteFile: true)
            exit(0)
        }
    }

    private func configure(id: String, deviceLabel: String?) {
        guard !engine.isRunning else {
            respond(id: id, ok: false, error: "cannot_configure_while_recording")
            return
        }
        requestedDeviceLabel = deviceLabel
        do {
            guard try prepareGraphIfAuthorized() else {
                respond(id: id, ok: false, error: "microphone_permission_not_granted")
                return
            }
            respond(id: id, ok: true, fields: [
                "selectedDeviceID": Int(selectedDeviceID)
            ])
        } catch {
            respond(id: id, ok: false, error: errorCode(error))
        }
    }

    private func start(id: String, deviceLabel: String?) {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            respond(id: id, ok: false, error: "microphone_permission_not_granted")
            return
        }
        if engine.isRunning {
            respond(id: id, ok: true, fields: ["alreadyRecording": true])
            return
        }

        do {
            if deviceLabel != requestedDeviceLabel {
                requestedDeviceLabel = deviceLabel
                graphPrepared = false
            }
            if !graphPrepared {
                guard try prepareGraphIfAuthorized() else {
                    respond(id: id, ok: false, error: "microphone_permission_not_granted")
                    return
                }
            }
            let url = outputDirectory
                .appendingPathComponent("recording-\(UUID().uuidString)")
                .appendingPathExtension("wav")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: outputSampleRate,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false
            ]
            let file = try AVAudioFile(
                forWriting: url,
                settings: settings,
                commonFormat: .pcmFormatFloat32,
                interleaved: false
            )
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: url.path
            )
            captureLock.lock()
            captureFile = file
            outputURL = url
            capturedFrames = 0
            recordingStartedAtNs = DispatchTime.now().uptimeNanoseconds
            firstAudioReported = false
            paused = false
            lastLevelSentAtNs = 0
            captureLock.unlock()

            try engine.start()
            respond(id: id, ok: true, fields: [
                "prepared": true,
                "mime": "audio/wav"
            ])
        } catch {
            endCapture(deleteFile: true)
            respond(id: id, ok: false, error: errorCode(error))
        }
    }

    private func stop(id: String) {
        guard engine.isRunning || outputURL != nil else {
            respond(id: id, ok: false, error: "not_recording")
            return
        }
        let result = finishCapture(deleteFile: false)
        guard let url = result.url else {
            respond(id: id, ok: false, error: "recording_file_missing")
            return
        }

        var fields: [String: Any] = [
            "path": url.path,
            "mime": "audio/wav",
            "duration": result.duration
        ]
        if let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
           let size = attributes[.size] as? NSNumber {
            fields["size"] = size.int64Value
        }
        respond(id: id, ok: true, fields: fields)
        prepareAfterCapture()
    }

    private func cancel(id: String) {
        endCapture(deleteFile: true)
        respond(id: id, ok: true)
        prepareAfterCapture()
    }

    private func pause(id: String) {
        guard engine.isRunning else {
            respond(id: id, ok: false, error: "not_recording")
            return
        }
        engine.pause()
        captureLock.lock()
        paused = true
        captureLock.unlock()
        respond(id: id, ok: true)
    }

    private func resume(id: String) {
        guard outputURL != nil else {
            respond(id: id, ok: false, error: "not_recording")
            return
        }
        do {
            try engine.start()
            captureLock.lock()
            paused = false
            captureLock.unlock()
            respond(id: id, ok: true)
        } catch {
            respond(id: id, ok: false, error: errorCode(error))
        }
    }

    private func status(id: String) {
        respond(id: id, ok: true, fields: [
            "authorization": authorizationName(),
            "prepared": graphPrepared,
            "recording": engine.isRunning,
            "paused": paused,
            "inputRunning": defaultInputRunningSomewhere() ?? false
        ])
    }

    private func shutdown(id: String) {
        endCapture(deleteFile: true)
        respond(id: id, ok: true)
        exit(0)
    }

    private func prepareGraphIfAuthorized() throws -> Bool {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            graphPrepared = false
            return false
        }
        try rebuildGraph()
        return true
    }

    private func rebuildGraph() throws {
        guard !engine.isRunning else { return }
        let input = engine.inputNode
        if tapInstalled {
            input.removeTap(onBus: 0)
            tapInstalled = false
        }
        engine.reset()

        guard let deviceID = inputDeviceID(matching: requestedDeviceLabel) else {
            throw NSError(
                domain: "OverlayNativeAudio",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "selected input device not found"]
            )
        }
        guard let audioUnit = input.audioUnit else {
            throw NSError(
                domain: "OverlayNativeAudio",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "audio input unit unavailable"]
            )
        }
        var mutableDeviceID = deviceID
        let selectionStatus = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &mutableDeviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        guard selectionStatus == noErr else {
            throw NSError(
                domain: NSOSStatusErrorDomain,
                code: Int(selectionStatus),
                userInfo: [NSLocalizedDescriptionKey: "failed to select audio input"]
            )
        }
        selectedDeviceID = deviceID

        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(
                domain: "OverlayNativeAudio",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "audio input format unavailable"]
            )
        }
        guard let monoOutputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: outputSampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw NSError(
                domain: "OverlayNativeAudio",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "output audio format unavailable"]
            )
        }
        outputFormat = monoOutputFormat
        converter =
            format.sampleRate == monoOutputFormat.sampleRate && format.channelCount == 1
            ? nil
            : AVAudioConverter(from: format, to: monoOutputFormat)
        input.installTap(onBus: 0, bufferSize: 256, format: format) {
            [weak self] buffer, _ in
            self?.consume(buffer: buffer)
        }
        tapInstalled = true
        engine.prepare()
        graphPrepared = true
    }

    private func consume(buffer: AVAudioPCMBuffer) {
        guard let buffer = convertToOutputFormat(buffer) else { return }
        captureLock.lock()
        guard let file = captureFile, !paused else {
            captureLock.unlock()
            return
        }
        let startedAt = recordingStartedAtNs
        let shouldReportFirstAudio = !firstAudioReported
        if shouldReportFirstAudio {
            firstAudioReported = true
        }
        capturedFrames += UInt64(buffer.frameLength)
        let shouldSendLevel =
            DispatchTime.now().uptimeNanoseconds - lastLevelSentAtNs >= 40_000_000
        if shouldSendLevel {
            lastLevelSentAtNs = DispatchTime.now().uptimeNanoseconds
        }
        do {
            try file.write(from: buffer)
        } catch {
            captureLock.unlock()
            writeJSON(["type": "recorder-error", "error": errorCode(error)])
            return
        }
        captureLock.unlock()

        if shouldReportFirstAudio, let startedAt {
            let elapsed = DispatchTime.now().uptimeNanoseconds - startedAt
            writeJSON([
                "type": "capture-active",
                "activationLatencyMs": Double(elapsed) / 1_000_000
            ])
        }
        if shouldSendLevel {
            writeJSON(["type": "level", "level": normalizedLevel(buffer)])
        }
    }

    private func normalizedLevel(_ buffer: AVAudioPCMBuffer) -> Double {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else {
            return 0
        }
        let samples = channels[0]
        var sum = 0.0
        for index in 0..<Int(buffer.frameLength) {
            let sample = Double(samples[index])
            sum += sample * sample
        }
        let rms = sqrt(sum / Double(buffer.frameLength))
        return max(0, min(1, rms * 5))
    }

    private func convertToOutputFormat(_ inputBuffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let outputFormat else { return nil }
        guard let converter else { return inputBuffer }
        let ratio = outputSampleRate / inputBuffer.format.sampleRate
        let capacity = AVAudioFrameCount(ceil(Double(inputBuffer.frameLength) * ratio)) + 8
        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: capacity
        ) else {
            return nil
        }

        var suppliedInput = false
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) {
            _, inputStatus in
            if suppliedInput {
                inputStatus.pointee = .noDataNow
                return nil
            }
            suppliedInput = true
            inputStatus.pointee = .haveData
            return inputBuffer
        }
        if status == .error {
            writeJSON([
                "type": "recorder-error",
                "error": conversionError.map(errorCode) ?? "audio_conversion_failed"
            ])
            return nil
        }
        return outputBuffer.frameLength > 0 ? outputBuffer : nil
    }

    private func finishCapture(deleteFile: Bool) -> (url: URL?, duration: Double) {
        if engine.isRunning {
            engine.stop()
        }
        graphPrepared = false

        captureLock.lock()
        let url = outputURL
        let duration = Double(capturedFrames) / outputSampleRate
        captureFile?.close()
        captureFile = nil
        outputURL = nil
        capturedFrames = 0
        recordingStartedAtNs = nil
        firstAudioReported = false
        paused = false
        captureLock.unlock()

        if deleteFile, let url {
            try? FileManager.default.removeItem(at: url)
        }
        return (url, duration)
    }

    private func endCapture(deleteFile: Bool) {
        _ = finishCapture(deleteFile: deleteFile)
    }

    private func prepareAfterCapture() {
        do {
            _ = try prepareGraphIfAuthorized()
        } catch {
            graphPrepared = false
            writeJSON([
                "type": "warning",
                "warning": "audio_graph_prepare_failed",
                "error": errorCode(error)
            ])
        }
    }

    private func installDeviceListener() {
        guard !deviceListenerInstalled else { return }
        deviceListenerInstalled = true
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectAddPropertyListenerBlock(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            queue
        ) { [weak self] _, _ in
            guard let self, !self.engine.isRunning, self.outputURL == nil else { return }
            do {
                try self.rebuildGraph()
                writeJSON(["type": "device-changed", "prepared": true])
            } catch {
                self.graphPrepared = false
                writeJSON([
                    "type": "warning",
                    "warning": "device_change_prepare_failed",
                    "error": errorCode(error)
                ])
            }
        }
    }

    private func authorizationName() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not-determined"
        @unknown default: return "unknown"
        }
    }

    private func removeAbandonedRecordings() throws {
        let entries = try FileManager.default.contentsOfDirectory(
            at: outputDirectory,
            includingPropertiesForKeys: nil
        )
        for entry in entries where entry.pathExtension == "wav" {
            try? FileManager.default.removeItem(at: entry)
        }
    }

    private func respond(
        id: String,
        ok: Bool,
        error: String? = nil,
        fields: [String: Any] = [:]
    ) {
        var value: [String: Any] = ["type": "response", "id": id, "ok": ok]
        if let error {
            value["error"] = error
        }
        for (key, fieldValue) in fields {
            value[key] = fieldValue
        }
        writeJSON(value)
    }
}

guard CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--output-dir" else {
    fputs("usage: native-audio-helper --output-dir <absolute-directory>\n", stderr)
    exit(64)
}

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard outputDirectory.path.hasPrefix("/") else {
    fputs("output directory must be absolute\n", stderr)
    exit(64)
}

private let helper = NativeAudioEngine(outputDirectory: outputDirectory)
helper.initialize()

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        helper.handle(line: line)
    }
    helper.parentDisconnected()
}

dispatchMain()
